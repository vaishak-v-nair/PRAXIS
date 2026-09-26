"""Bounded PDF ingestion with immutable indexes and atomic publication."""
from __future__ import annotations

import hashlib
import json
import os
import time
import uuid
from pathlib import Path

from filelock import FileLock, Timeout
from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pypdf import PdfReader

import config
from llm import is_transient
from vector_store import DATABASE_NAME, STORAGE_ENGINE, LocalVectorStore


def _pdf_paths() -> list[Path]:
    if not config.DATA_DIR.exists():
        return []
    root = config.DATA_DIR.resolve()
    paths = sorted(p for p in root.iterdir() if p.suffix.lower() == ".pdf")
    if len(paths) > config.MAX_PDF_FILES:
        raise ValueError("Too many PDF files; reduce documents or adjust MAX_PDF_FILES.")
    for path in paths:
        if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(root):
            raise ValueError("PDF documents must be regular files within the data directory.")
        if path.stat().st_size > config.MAX_PDF_MB * 1024 * 1024:
            raise ValueError(f"PDF {path.name} exceeds MAX_PDF_MB.")
    return paths


def _fingerprint() -> dict:
    files = []
    for path in _pdf_paths():
        digest = hashlib.sha256()
        with path.open("rb") as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(block)
        files.append({"name": path.name, "sha256": digest.hexdigest()})
    return {"schema": 3, "storage_engine": STORAGE_ENGINE, "files": files, "embedding_provider": config.EMBEDDING_PROVIDER,
            "embedding_model": config.EMBEDDING_MODEL, "chunk_size": config.CHUNK_SIZE,
            "chunk_overlap": config.CHUNK_OVERLAP, "splitter": "recursive-v1",
            "limits": {"max_pages": config.MAX_PDF_PAGES, "max_total_pages": config.MAX_TOTAL_PAGES,
                       "max_text": config.MAX_TEXT_CHARS, "max_chunks": config.MAX_CHUNKS}}


def _manifest_path() -> Path:
    return config.CHROMA_DIR / "manifest.json"


def _load_manifest() -> dict | None:
    try:
        manifest = json.loads(_manifest_path().read_text(encoding="utf-8"))
        version = manifest["version"]
        if not isinstance(version, str) or len(version) != 32 or any(c not in "0123456789abcdef" for c in version):
            return None
        if not isinstance(manifest.get("fingerprint"), dict) or not isinstance(manifest.get("chunk_count"), int):
            return None
        if not (config.CHROMA_DIR / "versions" / version / DATABASE_NAME).is_file():
            return None
        return manifest
    except (OSError, ValueError, KeyError, TypeError):
        # Preserve all old versions; a malformed pointer causes a fresh safe build.
        return None


def _needs_rebuild(force: bool = False) -> bool:
    manifest = _load_manifest()
    return force or manifest is None or manifest["fingerprint"] != _fingerprint()


def _publish_manifest(manifest: dict) -> None:
    target = _manifest_path()
    temporary = target.with_name(f"manifest-{uuid.uuid4().hex}.tmp")
    try:
        with temporary.open("w", encoding="utf-8") as stream:
            json.dump(manifest, stream, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)


def _load_documents() -> list[Document]:
    paths = _pdf_paths()
    if not paths:
        raise ValueError("No PDF files found. Add PDF documents to the data directory.")
    documents = []
    total_pages = 0
    total_chars = 0
    for path in paths:
        try:
            with path.open("rb") as stream:
                reader = PdfReader(stream, strict=True)
                if reader.is_encrypted:
                    raise ValueError("Encrypted PDFs are unsupported.")
                page_count = len(reader.pages)
                if page_count > config.MAX_PDF_PAGES or total_pages + page_count > config.MAX_TOTAL_PAGES:
                    raise ValueError("PDF page limit exceeded.")
                total_pages += page_count
                for page_number, page in enumerate(reader.pages):
                    text = page.extract_text() or ""
                    total_chars += len(text)
                    if total_chars > config.MAX_TEXT_CHARS:
                        raise ValueError("Extracted text exceeds MAX_TEXT_CHARS.")
                    if text.strip():
                        documents.append(Document(page_content=text, metadata={"source": path.name, "page": page_number}))
        except ValueError as error:
            # Only emit our known messages, never raw parser/provider exceptions.
            if str(error) in {"Encrypted PDFs are unsupported.", "PDF page limit exceeded.", "Extracted text exceeds MAX_TEXT_CHARS."}:
                raise ValueError(f"Cannot ingest {path.name}: {error}") from None
            raise ValueError(f"Cannot parse {path.name}. Use an unencrypted, valid text PDF.") from None
        except Exception:
            raise ValueError(f"Cannot parse {path.name}. Use an unencrypted, valid text PDF.") from None
    if not documents:
        raise ValueError("PDFs contain no extractable text. Apply OCR to scanned documents first.")
    return documents


def _split_documents(documents):
    splitter = RecursiveCharacterTextSplitter(chunk_size=config.CHUNK_SIZE, chunk_overlap=config.CHUNK_OVERLAP)
    chunks = splitter.split_documents(documents)
    if not chunks or len(chunks) > config.MAX_CHUNKS:
        raise ValueError("Invalid chunk count; reduce documents or adjust MAX_CHUNKS.")
    return chunks


class ProviderEmbeddings(Embeddings):
    """Public native endpoints with explicit timeout and no hidden retries."""

    def __init__(self):
        self.provider = config.EMBEDDING_PROVIDER
        self.model = config.EMBEDDING_MODEL
        self.timeout = config.REQUEST_TIMEOUT
        self.attempts = config.MAX_ATTEMPTS
        self._api_key = config.NVIDIA_API_KEY if self.provider == "nvidia" else config.GEMINI_API_KEY

    def _request(self, texts: list[str], query: bool) -> list[list[float]]:
        if self.provider == "nvidia":
            import httpx
            response = httpx.post(
                "https://integrate.api.nvidia.com/v1/embeddings",
                headers={"Authorization": "Bearer " + self._api_key},
                json={"model": self.model, "input": texts, "input_type": "query" if query else "passage",
                      "encoding_format": "float", "truncate": "NONE"}, timeout=self.timeout)
            response.raise_for_status()
            data = sorted(response.json()["data"], key=lambda item: item["index"])
            if [item["index"] for item in data] != list(range(len(texts))):
                raise ValueError("Incomplete embedding response.")
            return [item["embedding"] for item in data]
        from google import genai
        from google.genai import types
        # SDK timeout is milliseconds; disable SDK retries, controlled below instead.
        with genai.Client(api_key=self._api_key, http_options=types.HttpOptions(
            timeout=self.timeout * 1000, retry_options=types.HttpRetryOptions(attempts=1))) as client:
            response = client.models.embed_content(model=self.model, contents=texts,
                config=types.EmbedContentConfig(task_type="RETRIEVAL_QUERY" if query else "RETRIEVAL_DOCUMENT"))
        return [embedding.values for embedding in response.embeddings or []]

    def _bounded_request(self, texts: list[str], query: bool) -> list[list[float]]:
        for attempt in range(self.attempts):
            try:
                result = self._request(texts, query)
                if len(result) != len(texts) or any(not row for row in result):
                    raise ValueError("Invalid embedding response.")
                return result
            except Exception as error:
                if is_transient(error) and attempt + 1 < self.attempts:
                    time.sleep(min(2 ** attempt, 4))
                    continue
                raise RuntimeError("Embedding request failed. Check model access, credentials, quota, and input limits.") from None
        raise RuntimeError("Embedding attempts exhausted.")

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        result = []
        for start in range(0, len(texts), 32):
            result.extend(self._bounded_request(texts[start:start + 32], query=False))
        return result

    def embed_query(self, text: str) -> list[float]:
        return self._bounded_request([text], query=True)[0]


def _get_embeddings():
    return ProviderEmbeddings()


def build_vectorstore(force: bool = False) -> LocalVectorStore:
    """Serialize builders, build a new version, publish only a verified snapshot."""
    config.validate_config()
    config.CHROMA_DIR.mkdir(parents=True, exist_ok=True)
    try:
        with FileLock(str(config.CHROMA_DIR / ".build.lock"), timeout=120):
            fingerprint = _fingerprint()
            try:
                embeddings = _get_embeddings()
            except Exception:
                raise RuntimeError("Cannot initialize embedding provider. Check model, credentials, and installed provider packages.") from None
            manifest = _load_manifest()
            if not force and manifest and manifest["fingerprint"] == fingerprint:
                try:
                    store = LocalVectorStore(persist_directory=str(config.CHROMA_DIR / "versions" / manifest["version"]),
                                   embedding_function=embeddings)
                    if len(store.get(include=[], limit=config.MAX_CHUNKS + 1)["ids"]) == manifest["chunk_count"]:
                        return store
                except Exception:
                    pass  # Do not destroy a corrupt/unreadable version; rebuild separately.
            chunks = _split_documents(_load_documents())
            version = uuid.uuid4().hex
            directory = config.CHROMA_DIR / "versions" / version
            directory.mkdir(parents=True)
            try:
                store = LocalVectorStore.from_documents(documents=chunks, embedding=embeddings,
                                              persist_directory=str(directory))
                if len(store.get(include=[], limit=config.MAX_CHUNKS + 1)["ids"]) != len(chunks):
                    raise RuntimeError("Incomplete index.")
                if _fingerprint() != fingerprint:
                    raise RuntimeError("Documents changed while building.")
                _publish_manifest({"version": version, "fingerprint": fingerprint, "chunk_count": len(chunks)})
                return store
            except Exception:
                raise RuntimeError("Index rebuild failed; the previous index is preserved. Check documents, embedding access, and disk space, then retry.") from None
    except Timeout:
        raise RuntimeError("Another session is rebuilding the index. Wait and retry.") from None


def get_retriever(force_rebuild: bool = False):
    return build_vectorstore(force=force_rebuild).as_retriever(search_kwargs={"k": config.TOP_K})


def list_source_documents() -> list[str]:
    return [path.name for path in _pdf_paths()]
