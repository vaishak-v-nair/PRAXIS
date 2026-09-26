"""Local SQLite cosine retrieval: JSON data only, no executable model artifacts."""
from __future__ import annotations

import heapq
import json
import math
import sqlite3
import uuid
from contextlib import contextmanager
from pathlib import Path

from langchain_core.documents import Document
from langchain_core.embeddings import Embeddings
from langchain_core.runnables import RunnableLambda

import config

DATABASE_NAME = "vectors.sqlite3"
STORAGE_ENGINE = "sqlite-cosine-v1"
MAX_DIMENSIONS = 8192
MAX_METADATA_CHARS = 4096
MAX_VECTOR_CHARS = MAX_DIMENSIONS * 32


def normalized_vector(values, dimensions: int | None = None) -> list[float]:
    """Reject malformed vectors and normalize without overflowing large floats."""
    if not isinstance(values, (list, tuple)) or not 1 <= len(values) <= MAX_DIMENSIONS:
        raise ValueError("Embedding vectors must have between 1 and 8192 dimensions.")
    if dimensions is not None and len(values) != dimensions:
        raise ValueError("Embedding dimensions do not match the stored index.")
    if any(type(value) not in (int, float) for value in values):
        raise ValueError("Embedding vectors must contain finite numbers.")
    try:
        vector = [float(value) for value in values]
    except (OverflowError, ValueError):
        raise ValueError("Embedding vectors must contain finite numbers.") from None
    if not all(math.isfinite(value) for value in vector):
        raise ValueError("Embedding vectors must contain finite numbers.")
    scale = max(abs(value) for value in vector)
    if scale == 0:
        raise ValueError("Embedding vectors must have a nonzero norm.")
    scaled = [value / scale for value in vector]
    norm = math.sqrt(math.fsum(value * value for value in scaled))
    return [value / norm for value in scaled]


def _metadata_json(metadata) -> str:
    if not isinstance(metadata, dict):
        raise ValueError("Document metadata must be a JSON object.")
    try:
        text = json.dumps(metadata, ensure_ascii=False, allow_nan=False)
    except (TypeError, ValueError, OverflowError, RecursionError):
        raise ValueError("Document metadata must contain only JSON values.") from None
    if len(text) > MAX_METADATA_CHARS:
        raise ValueError("Document metadata exceeds the index limit.")
    return text


class LocalVectorStore:
    """Immutable persisted collection; retrieval streams vectors using bounded top-k."""

    def __init__(self, persist_directory: str, embedding_function: Embeddings):
        self.directory = Path(persist_directory)
        self.path = self.directory / DATABASE_NAME
        self.embeddings = embedding_function
        self.max_chunks = config.MAX_CHUNKS
        if self.directory.is_symlink() or self.path.is_symlink() or not self.path.is_file():
            raise RuntimeError("Local vector index is missing or unsafe; rebuild it.")
        try:
            with self._connect() as connection:
                self._verify(connection)
        except (sqlite3.Error, ValueError, TypeError, KeyError, RecursionError):
            raise RuntimeError("Local vector index is invalid; rebuild it. Existing files are preserved.") from None

    @contextmanager
    def _connect(self):
        connection = sqlite3.connect(self.path.resolve().as_uri() + "?mode=ro", uri=True, timeout=5)
        try:
            connection.execute("PRAGMA trusted_schema=OFF")
            connection.execute("PRAGMA query_only=ON")
            yield connection
        finally:
            connection.close()

    def _verify(self, connection):
        # Reject views/triggers and unexpected tables before querying an existing cache.
        objects = connection.execute("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view', 'trigger')").fetchall()
        if set(objects) != {("documents", "table"), ("index_metadata", "table")}:
            raise ValueError("Invalid local index schema.")
        settings = connection.execute("SELECT schema_version, dimensions, row_count FROM index_metadata").fetchall()
        if len(settings) != 1:
            raise ValueError("Invalid local index settings.")
        schema, dimensions, count = settings[0]
        if schema != 1 or type(dimensions) is not int or not 1 <= dimensions <= MAX_DIMENSIONS:
            raise ValueError("Invalid local index dimensions.")
        if type(count) is not int or not 1 <= count <= self.max_chunks:
            raise ValueError("Invalid local index size.")
        bounds = connection.execute("SELECT COUNT(*), MAX(LENGTH(content)), SUM(LENGTH(content)), MAX(LENGTH(metadata)), MAX(LENGTH(vector)) FROM documents").fetchone()
        if bounds[0] != count or bounds[1] > config.MAX_TEXT_CHARS or bounds[2] > config.MAX_TEXT_CHARS * 2:
            raise ValueError("Local index text limit exceeded.")
        if bounds[3] > MAX_METADATA_CHARS or bounds[4] > MAX_VECTOR_CHARS:
            raise ValueError("Local index JSON limit exceeded.")
        for metadata, vector in connection.execute("SELECT metadata, vector FROM documents"):
            parsed = json.loads(metadata)
            if not isinstance(parsed, dict):
                raise ValueError("Invalid local index metadata.")
            _metadata_json(parsed)
            normalized_vector(json.loads(vector), dimensions)
        self.dimensions = dimensions
        self.count = count

    @classmethod
    def from_documents(cls, documents: list[Document], embedding: Embeddings, persist_directory: str):
        if not 1 <= len(documents) <= config.MAX_CHUNKS:
            raise ValueError("Document count exceeds the local index limit.")
        directory = Path(persist_directory)
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / DATABASE_NAME
        if directory.is_symlink() or path.exists() or path.is_symlink():
            raise ValueError("An index build requires a fresh version directory.")
        total_chars = 0
        metadata_texts = []
        for document in documents:
            if not isinstance(document.page_content, str) or not document.page_content.strip():
                raise ValueError("Index documents must contain text.")
            total_chars += len(document.page_content)
            if total_chars > config.MAX_TEXT_CHARS * 2:
                raise ValueError("Indexed text exceeds the local index limit.")
            metadata_texts.append(_metadata_json(document.metadata))
        connection = sqlite3.connect(path, timeout=5)
        try:
            connection.execute("PRAGMA trusted_schema=OFF")
            connection.execute("CREATE TABLE documents (id TEXT PRIMARY KEY, position INTEGER UNIQUE NOT NULL, content TEXT NOT NULL, metadata TEXT NOT NULL, vector TEXT NOT NULL)")
            connection.execute("CREATE TABLE index_metadata (schema_version INTEGER NOT NULL, dimensions INTEGER NOT NULL, row_count INTEGER NOT NULL)")
            dimensions = None
            for start in range(0, len(documents), 32):
                batch = documents[start:start + 32]
                vectors = embedding.embed_documents([document.page_content for document in batch])
                if not isinstance(vectors, list) or len(vectors) != len(batch):
                    raise ValueError("Embedding response does not match the document count.")
                records = []
                for offset, (document, vector) in enumerate(zip(batch, vectors, strict=True)):
                    vector = normalized_vector(vector, dimensions)
                    if dimensions is None:
                        dimensions = len(vector)
                    records.append((uuid.uuid4().hex, start + offset, document.page_content,
                                    metadata_texts[start + offset], json.dumps(vector, allow_nan=False)))
                connection.executemany("INSERT INTO documents (id, position, content, metadata, vector) VALUES (?, ?, ?, ?, ?)", records)
            connection.execute("INSERT INTO index_metadata (schema_version, dimensions, row_count) VALUES (?, ?, ?)", (1, dimensions, len(documents)))
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()
        return cls(str(directory), embedding_function=embedding)

    def get(self, include=None, limit=None) -> dict:
        include = ["documents", "metadatas"] if include is None else include
        if any(item not in {"documents", "metadatas"} for item in include):
            raise ValueError("Unsupported local index fields.")
        limit = self.max_chunks if limit is None else limit
        if type(limit) is not int or not 1 <= limit <= self.max_chunks + 1:
            raise ValueError("Invalid local index result limit.")
        with self._connect() as connection:
            if not include:
                return {"ids": [row[0] for row in connection.execute("SELECT id FROM documents ORDER BY position LIMIT ?", (limit,))]}
            rows = connection.execute("SELECT id, content, metadata FROM documents ORDER BY position LIMIT ?", (limit,)).fetchall()
        result = {"ids": [row[0] for row in rows]}
        if "documents" in include:
            result["documents"] = [row[1] for row in rows]
        if "metadatas" in include:
            result["metadatas"] = [json.loads(row[2]) for row in rows]
        return result

    def similarity_search(self, query: str, k: int = 4) -> list[Document]:
        if not isinstance(query, str) or not query.strip() or len(query) > 6000:
            raise ValueError("Retrieval requires a nonempty query of at most 6000 characters.")
        if type(k) is not int or not 1 <= k <= 20:
            raise ValueError("Retrieval k must be between 1 and 20.")
        vector = normalized_vector(self.embeddings.embed_query(query), self.dimensions)
        best = []
        with self._connect() as connection:
            for position, content, metadata, encoded in connection.execute("SELECT position, content, metadata, vector FROM documents ORDER BY position LIMIT ?", (self.max_chunks,)):
                stored = normalized_vector(json.loads(encoded), self.dimensions)
                score = math.fsum(left * right for left, right in zip(vector, stored, strict=True))
                # Earlier chunks win deterministic ties; heap stores at most k excerpts.
                item = (score, -position, content, metadata)
                if len(best) < k:
                    heapq.heappush(best, item)
                elif item[:2] > best[0][:2]:
                    heapq.heapreplace(best, item)
        return [Document(page_content=content, metadata=json.loads(metadata))
                for _, _, content, metadata in sorted(best, reverse=True)]

    def as_retriever(self, search_kwargs=None):
        k = (search_kwargs or {}).get("k", 4)
        if type(k) is not int or not 1 <= k <= 20:
            raise ValueError("Retrieval k must be between 1 and 20.")
        return RunnableLambda(lambda query: self.similarity_search(query, k=k))
