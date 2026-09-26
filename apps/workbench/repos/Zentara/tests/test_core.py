"""Regression checks run offline: no credentials and no paid model requests."""
import sys
from pathlib import Path

import pytest
from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from pypdf import PdfWriter

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import config
import ingest
import llm


@pytest.fixture
def documents(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path / "data")
    monkeypatch.setattr(config, "CHROMA_DIR", tmp_path / "index")
    config.DATA_DIR.mkdir()
    (config.DATA_DIR / "manual.pdf").write_bytes(b"original")
    monkeypatch.setattr(config, "validate_config", lambda: None)
    return config.DATA_DIR


@pytest.mark.parametrize("value", ["abc", "0", "21", "sk-secret-invalid"])
def test_bounded_config_rejects(monkeypatch, value):
    monkeypatch.setenv("TEST_LIMIT", value)
    with pytest.raises(ValueError, match="TEST_LIMIT") as error:
        config.bounded_int("TEST_LIMIT", 4, 1, 20)
    assert "sk-secret-invalid" not in str(error.value)


def test_bounded_config_accepts(monkeypatch):
    monkeypatch.setenv("TEST_LIMIT", "20")
    assert config.bounded_int("TEST_LIMIT", 4, 1, 20) == 20


def test_fallback_explicit_and_boolean_strict(monkeypatch):
    monkeypatch.setattr(config, "NVIDIA_API_KEY", "fixture-key")
    monkeypatch.setattr(config, "ENABLE_NIM_FALLBACK", False)
    assert not config.has_nim_fallback()
    monkeypatch.setattr(config, "ENABLE_NIM_FALLBACK", True)
    assert config.has_nim_fallback()
    monkeypatch.setenv("TEST_BOOL", "true")
    assert config.strict_bool("TEST_BOOL")
    monkeypatch.setenv("TEST_BOOL", "sk-invalid")
    with pytest.raises(ValueError, match="must be true or false") as error:
        config.strict_bool("TEST_BOOL")
    assert "sk-invalid" not in str(error.value)


def test_overlap_and_provider_key_validation(monkeypatch):
    monkeypatch.setattr(config, "CHUNK_OVERLAP", config.CHUNK_SIZE)
    with pytest.raises(ValueError, match="CHUNK_OVERLAP"):
        config.validate_config()
    monkeypatch.setattr(config, "CHUNK_OVERLAP", 0)
    monkeypatch.setattr(config, "CHAT_PROVIDER", "groq")
    monkeypatch.setattr(config, "EMBEDDING_PROVIDER", "nvidia")
    monkeypatch.setattr(config, "NVIDIA_API_KEY", "fixture-key")
    monkeypatch.setattr(config, "GROQ_API_KEY", "")
    with pytest.raises(ValueError, match="GROQ_API_KEY"):
        config.validate_config()


def test_fingerprint_invalidates_all_changes(documents, monkeypatch):
    original = ingest._fingerprint()
    (documents / "manual.pdf").write_bytes(b"modified")
    changed = ingest._fingerprint()
    assert changed != original
    (documents / "second.PDF").write_bytes(b"added")
    assert ingest._fingerprint() != changed
    (documents / "second.PDF").unlink()
    assert ingest._fingerprint() == changed
    (documents / "manual.pdf").unlink()
    assert ingest._fingerprint()["files"] == []
    (documents / "manual.pdf").write_bytes(b"original")
    monkeypatch.setattr(config, "EMBEDDING_MODEL", "other-embedding")
    assert ingest._fingerprint() != original
    monkeypatch.setattr(config, "EMBEDDING_MODEL", original["embedding_model"])
    monkeypatch.setattr(config, "CHUNK_OVERLAP", config.CHUNK_OVERLAP + 1)
    assert ingest._fingerprint() != original


def test_corrupt_manifest_preserved(documents):
    config.CHROMA_DIR.mkdir()
    pointer = config.CHROMA_DIR / "manifest.json"
    pointer.write_text("{broken", encoding="utf-8")
    assert ingest._load_manifest() is None
    assert pointer.read_text() == "{broken"


def test_legacy_chroma_rebuild_failure_preserves_legacy_files(documents, monkeypatch):
    version = "b" * 32
    old = config.CHROMA_DIR / "versions" / version
    old.mkdir(parents=True)
    (old / "chroma.sqlite3").write_bytes(b"legacy untouched index")
    legacy = {"version": version, "fingerprint": {"schema": 2}, "chunk_count": 1}
    ingest._publish_manifest(legacy)
    pointer_before = (config.CHROMA_DIR / "manifest.json").read_bytes()
    assert ingest._fingerprint()["storage_engine"] == "sqlite-cosine-v1"
    assert ingest._needs_rebuild()
    monkeypatch.setattr(ingest, "_get_embeddings", lambda: object())
    monkeypatch.setattr(ingest, "_load_documents", lambda: [object()])
    monkeypatch.setattr(ingest, "_split_documents", lambda docs: docs)
    def fail(**kwargs):
        raise RuntimeError("embedding unavailable")
    monkeypatch.setattr(ingest.LocalVectorStore, "from_documents", fail)
    with pytest.raises(RuntimeError, match="previous index is preserved"):
        ingest.build_vectorstore()
    assert (config.CHROMA_DIR / "manifest.json").read_bytes() == pointer_before
    assert (old / "chroma.sqlite3").read_bytes() == b"legacy untouched index"


def test_failed_rebuild_preserves_index(documents, monkeypatch):
    version = "a" * 32
    old = config.CHROMA_DIR / "versions" / version
    old.mkdir(parents=True)
    (old / "vectors.sqlite3").write_bytes(b"valid index")
    manifest = {"version": version, "fingerprint": ingest._fingerprint(), "chunk_count": 1}
    ingest._publish_manifest(manifest)
    monkeypatch.setattr(ingest, "_get_embeddings", lambda: object())
    monkeypatch.setattr(ingest, "_load_documents", lambda: [object()])
    monkeypatch.setattr(ingest, "_split_documents", lambda docs: docs)
    def fail(**kwargs):
        raise RuntimeError("sk-upstream-credential-do-not-leak")
    monkeypatch.setattr(ingest.LocalVectorStore, "from_documents", fail)
    with pytest.raises(RuntimeError, match="previous index is preserved") as error:
        ingest.build_vectorstore(force=True)
    assert "sk-upstream" not in str(error.value)
    assert ingest._load_manifest() == manifest
    assert (old / "vectors.sqlite3").read_bytes() == b"valid index"


def test_bad_pdf_and_size_limit(documents, monkeypatch):
    with pytest.raises(ValueError, match="Cannot parse"):
        ingest._load_documents()
    monkeypatch.setattr(config, "MAX_PDF_MB", 0)
    with pytest.raises(ValueError, match="MAX_PDF_MB"):
        ingest._pdf_paths()


def test_real_pdf_page_limit_empty_and_encrypted(documents, monkeypatch):
    writer = PdfWriter()
    writer.add_blank_page(width=100, height=100)
    writer.add_blank_page(width=100, height=100)
    writer.write(documents / "manual.pdf")
    monkeypatch.setattr(config, "MAX_PDF_PAGES", 1)
    with pytest.raises(ValueError, match="PDF page limit"):
        ingest._load_documents()
    monkeypatch.setattr(config, "MAX_PDF_PAGES", 10)
    with pytest.raises(ValueError, match="no extractable text"):
        ingest._load_documents()
    writer.encrypt("test-password")
    writer.write(documents / "manual.pdf")
    with pytest.raises(ValueError, match="Encrypted PDFs"):
        ingest._load_documents()


def test_pdf_file_count_limit(documents, monkeypatch):
    (documents / "second.pdf").write_bytes(b"second")
    monkeypatch.setattr(config, "MAX_PDF_FILES", 1)
    with pytest.raises(ValueError, match="Too many PDF"):
        ingest._pdf_paths()


def test_successful_build_publish_then_reuse(documents, monkeypatch):
    builds = []
    class Store:
        def __init__(self, persist_directory, embedding_function=None):
            self.directory = Path(persist_directory)
        @classmethod
        def from_documents(cls, documents, embedding, persist_directory):
            builds.append(persist_directory)
            store = cls(persist_directory)
            (store.directory / "vectors.sqlite3").write_bytes(b"fixture store")
            return store
        def get(self, **kwargs):
            return {"ids": ["one"]}
    monkeypatch.setattr(ingest, "LocalVectorStore", Store)
    monkeypatch.setattr(ingest, "_get_embeddings", lambda: object())
    monkeypatch.setattr(ingest, "_load_documents", lambda: [object()])
    monkeypatch.setattr(ingest, "_split_documents", lambda docs: docs)
    first = ingest.build_vectorstore()
    manifest = ingest._load_manifest()
    assert manifest["chunk_count"] == 1
    assert ingest.build_vectorstore().directory == first.directory
    assert len(builds) == 1
    (documents / "second.pdf").write_bytes(b"addition")
    second = ingest.build_vectorstore()
    assert second.directory != first.directory
    assert first.directory.exists()
    assert len(builds) == 2


def test_changes_during_build_do_not_publish(documents, monkeypatch):
    monkeypatch.setattr(ingest, "_get_embeddings", lambda: object())
    monkeypatch.setattr(ingest, "_load_documents", lambda: [object()])
    monkeypatch.setattr(ingest, "_split_documents", lambda docs: docs)
    class Store:
        @classmethod
        def from_documents(cls, **kwargs):
            (documents / "manual.pdf").write_bytes(b"concurrent edit")
            return cls()
        def get(self, **kwargs):
            return {"ids": ["one"]}
    monkeypatch.setattr(ingest, "LocalVectorStore", Store)
    with pytest.raises(RuntimeError, match="previous index is preserved"):
        ingest.build_vectorstore()
    assert not (config.CHROMA_DIR / "manifest.json").exists()


def test_actual_sqlite_persists_and_retrieves(documents, monkeypatch):
    class LocalEmbeddings(Embeddings):
        def embed_documents(self, texts):
            return [[1.0, 0.0, 0.0] for _ in texts]
        def embed_query(self, text):
            return [1.0, 0.0, 0.0]
    monkeypatch.setattr(ingest, "_get_embeddings", LocalEmbeddings)
    monkeypatch.setattr(ingest, "_load_documents", lambda: [Document(
        page_content="A test robot uses a safety guard.", metadata={"source": "manual.pdf", "page": 0})])
    first = ingest.build_vectorstore()
    assert len(first.get(include=[])["ids"]) == 1
    reloaded = ingest.build_vectorstore()
    results = reloaded.as_retriever(search_kwargs={"k": 1}).invoke("safety guard")
    assert results[0].metadata == {"source": "manual.pdf", "page": 0}
    assert results[0].page_content == "A test robot uses a safety guard."


def test_busy_builder_safe_error(documents, monkeypatch):
    class BusyLock:
        def __init__(self, *args, **kwargs):
            pass
        def __enter__(self):
            raise ingest.Timeout("fixture.lock")
        def __exit__(self, *args):
            pass
    monkeypatch.setattr(ingest, "FileLock", BusyLock)
    with pytest.raises(RuntimeError, match="Another session"):
        ingest.build_vectorstore()


class StatusError(Exception):
    def __init__(self, status):
        self.status_code = status
        super().__init__("sk-sensitive-provider-message")


class MockModel(BaseChatModel):
    responses: list
    calls: int = 0

    @property
    def _llm_type(self):
        return "fixture"

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        response = self.responses[min(self.calls, len(self.responses) - 1)]
        self.calls += 1
        if isinstance(response, Exception):
            raise response
        return ChatResult(generations=[ChatGeneration(message=AIMessage(content=response))])


def test_transient_retry_and_per_call_provenance(monkeypatch):
    monkeypatch.setattr(llm.time, "sleep", lambda _: None)
    primary = MockModel(responses=[StatusError(503), StatusError(503), "recovered"])
    fallback = MockModel(responses=["fallback"])
    model = llm.FallbackChatModel(primary=primary, fallback=fallback, max_attempts=2)
    first = model.invoke([HumanMessage(content="hello")])
    second = model.invoke([HumanMessage(content="hello")])
    assert first.response_metadata["used_fallback"] is True
    assert second.response_metadata["used_fallback"] is False
    assert first.response_metadata["used_fallback"] is True
    assert primary.calls == 3 and fallback.calls == 1


@pytest.mark.parametrize("status", [400, 401, 403, 404, 422])
def test_permanent_errors_never_retry_or_leak(status):
    primary = MockModel(responses=[StatusError(status)])
    fallback = MockModel(responses=["must not run"])
    model = llm.FallbackChatModel(primary=primary, fallback=fallback)
    with pytest.raises(RuntimeError) as error:
        model.invoke([HumanMessage(content="hello")])
    assert primary.calls == 1 and fallback.calls == 0
    assert "sk-sensitive" not in str(error.value)


@pytest.mark.parametrize("status", [408, 429, 500, 502, 503, 504])
def test_transient_classifier(status):
    assert llm.is_transient(StatusError(status))


def test_wrapped_provider_status_retains_retry_classification():
    wrapped = RuntimeError("provider wrapper")
    wrapped.__cause__ = StatusError(429)
    assert llm.is_transient(wrapped)
    wrapped.__cause__ = StatusError(401)
    assert not llm.is_transient(wrapped)


def test_embeddings_retry_transient_and_sanitize(monkeypatch):
    monkeypatch.setattr(ingest.time, "sleep", lambda _: None)
    embedder = ingest.ProviderEmbeddings()
    embedder.attempts = 2
    calls = []
    def temporary(texts, query):
        calls.append(query)
        if len(calls) == 1:
            raise StatusError(503)
        return [[0.1, 0.2] for _ in texts]
    monkeypatch.setattr(embedder, "_request", temporary)
    assert embedder.embed_query("question") == [0.1, 0.2]
    assert calls == [True, True]
    calls.clear()
    def permanent(texts, query):
        calls.append(query)
        raise StatusError(401)
    monkeypatch.setattr(embedder, "_request", permanent)
    with pytest.raises(RuntimeError) as error:
        embedder.embed_documents(["document"])
    assert calls == [False]
    assert "sk-sensitive" not in str(error.value)


def test_embedding_rejects_incomplete_response(monkeypatch):
    embedder = ingest.ProviderEmbeddings()
    monkeypatch.setattr(embedder, "_request", lambda texts, query: [])
    with pytest.raises(RuntimeError, match="Embedding request failed"):
        embedder.embed_query("question")


@pytest.mark.parametrize("model_name", ["openai/gpt-oss-20b", "openai/gpt-oss-120b"])
def test_groq_supported_models_forward_reasoning_effort(monkeypatch, model_name):
    monkeypatch.setattr(config, "GROQ_API_KEY", "fixture-key-no-network")
    monkeypatch.setattr(config, "GROQ_MODEL", model_name)
    monkeypatch.setattr(config, "GROQ_REASONING_EFFORT", "low")
    model = llm._provider_model("groq")
    assert model.reasoning_effort == "low"
    assert model.max_retries == 0
    assert model.max_tokens == config.MAX_OUTPUT_TOKENS


def test_groq_other_models_omit_reasoning_effort(monkeypatch):
    monkeypatch.setattr(config, "GROQ_API_KEY", "fixture-key-no-network")
    monkeypatch.setattr(config, "GROQ_MODEL", "custom/model")
    monkeypatch.setattr(config, "GROQ_REASONING_EFFORT", "high")
    assert llm._provider_model("groq").reasoning_effort is None


def test_invalid_reasoning_configuration_is_clear_and_sanitized(monkeypatch):
    monkeypatch.setattr(config, "GROQ_REASONING_EFFORT", "sk-sensitive-invalid")
    with pytest.raises(ValueError, match="GROQ_REASONING_EFFORT") as error:
        config.validate_config()
    assert "sk-sensitive" not in str(error.value)
