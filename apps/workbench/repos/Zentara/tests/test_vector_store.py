"""Offline persistence, cosine ranking, bounds, and non-executable index checks."""
import json
import sqlite3

import pytest
from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings

import config
from vector_store import LocalVectorStore, normalized_vector


class FixedEmbeddings(Embeddings):
    def embed_documents(self, texts):
        mapping = {"east": [1.0, 0.0], "near east": [2.0, 1.0], "west": [-1.0, 0.0]}
        return [mapping.get(text, [1.0, 0.0]) for text in texts]

    def embed_query(self, text):
        return [1.0, 0.0]


def create_store(tmp_path):
    docs = [Document(page_content=text, metadata={"source": "manual.pdf", "page": page})
            for page, text in enumerate(["west", "near east", "east"])]
    return LocalVectorStore.from_documents(docs, FixedEmbeddings(), str(tmp_path / "version"))


def test_persistent_cosine_ranking_and_citation_metadata(tmp_path):
    store = create_store(tmp_path)
    restored = LocalVectorStore(str(store.directory), FixedEmbeddings())
    assert [doc.page_content for doc in restored.similarity_search("east", k=2)] == ["east", "near east"]
    result = restored.as_retriever({"k": 1}).invoke("east")
    assert result[0].metadata == {"source": "manual.pdf", "page": 2}
    assert len(restored.get(include=[])["ids"]) == 3
    # Windows permits the move only when all SQLite connections are closed.
    store.path.rename(store.path.with_suffix(".moved"))


@pytest.mark.parametrize("vector", [[], [0, 0], [float("nan"), 1], [float("inf")],
                                   [True, 1], ["1", 2], None, [1] * 8193])
def test_invalid_vectors_rejected(vector):
    with pytest.raises(ValueError, match="Embedding"):
        normalized_vector(vector)


def test_normalization_avoids_overflow_and_rejects_mismatched_dimensions():
    vector = normalized_vector([1e308, 1e308])
    assert vector == pytest.approx([2 ** -0.5, 2 ** -0.5])
    with pytest.raises(ValueError, match="dimensions"):
        normalized_vector([1, 0], dimensions=3)


def test_inconsistent_document_vectors_never_create_usable_index(tmp_path):
    class Inconsistent(FixedEmbeddings):
        def embed_documents(self, texts):
            return [[1, 0], [1, 0, 0]]
    directory = tmp_path / "version"
    with pytest.raises(ValueError, match="dimensions"):
        LocalVectorStore.from_documents([Document(page_content="one"), Document(page_content="two")],
                                        Inconsistent(), str(directory))
    with pytest.raises(RuntimeError, match="invalid"):
        LocalVectorStore(str(directory), FixedEmbeddings())


def test_dimension_change_at_query_rejected(tmp_path):
    store = create_store(tmp_path)
    class Changed(FixedEmbeddings):
        def embed_query(self, text):
            return [1, 0, 0]
    store.embeddings = Changed()
    with pytest.raises(ValueError, match="dimensions"):
        store.similarity_search("east")


def test_sql_injection_strings_are_only_data(tmp_path):
    text = "'); DROP TABLE documents; --"
    metadata = {"source": text, "payload": {"__reduce__": "os.system('unsafe')"}}
    store = LocalVectorStore.from_documents([Document(page_content=text, metadata=metadata)],
                                            FixedEmbeddings(), str(tmp_path / "version"))
    result = store.similarity_search("query", k=1)[0]
    assert result.page_content == text
    assert result.metadata == metadata
    with sqlite3.connect(store.path) as connection:
        assert connection.execute("SELECT COUNT(*) FROM documents").fetchone()[0] == 1
        encoded = connection.execute("SELECT metadata, vector FROM documents").fetchone()
        assert json.loads(encoded[0]) == metadata
        assert isinstance(json.loads(encoded[1]), list)


def test_non_json_metadata_rejected_without_executing_hooks(tmp_path):
    class Executable:
        def __reduce__(self):
            raise AssertionError("Serialization hooks must never execute.")
    with pytest.raises(ValueError, match="only JSON"):
        LocalVectorStore.from_documents([Document(page_content="text", metadata={"object": Executable()})],
                                        FixedEmbeddings(), str(tmp_path / "version"))


@pytest.mark.parametrize("schema", ["CREATE TABLE unexpected (payload TEXT)",
                                   "CREATE VIEW executable_view AS SELECT load_extension('untrusted')",
                                   "CREATE TRIGGER unexpected_trigger AFTER INSERT ON documents BEGIN SELECT 1; END"])
def test_unexpected_schema_objects_rejected(tmp_path, schema):
    store = create_store(tmp_path)
    with sqlite3.connect(store.path) as connection:
        connection.execute(schema)
    with pytest.raises(RuntimeError, match="invalid"):
        LocalVectorStore(str(store.directory), FixedEmbeddings())
    assert store.path.exists()


def test_corrupt_json_index_rejected_and_preserved(tmp_path):
    store = create_store(tmp_path)
    with sqlite3.connect(store.path) as connection:
        connection.execute("UPDATE documents SET vector = ? WHERE position = ?", ("not-json-sensitive-text", 0))
    with pytest.raises(RuntimeError, match="invalid") as error:
        LocalVectorStore(str(store.directory), FixedEmbeddings())
    assert "sensitive-text" not in str(error.value)
    assert store.path.exists()


def test_limits_fresh_versions_and_read_only_connections(tmp_path, monkeypatch):
    store = create_store(tmp_path)
    with pytest.raises(ValueError, match="fresh version"):
        LocalVectorStore.from_documents([Document(page_content="text")], FixedEmbeddings(), str(store.directory))
    with store._connect() as connection:
        assert connection.execute("PRAGMA trusted_schema").fetchone()[0] == 0
        with pytest.raises(sqlite3.OperationalError, match="readonly"):
            connection.execute("DELETE FROM documents")
    with pytest.raises(ValueError, match="between 1 and 20"):
        store.similarity_search("query", k=21)
    with pytest.raises(ValueError, match="result limit"):
        store.get(include=[], limit=0)
    monkeypatch.setattr(config, "MAX_CHUNKS", 2)
    with pytest.raises(RuntimeError, match="invalid"):
        LocalVectorStore(str(store.directory), FixedEmbeddings())
