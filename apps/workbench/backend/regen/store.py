"""Small, durable SQLite job store. Credentials are never stored here."""
from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path


class Store:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self.lock = threading.RLock()
        with self.connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, data TEXT NOT NULL)")

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=30)
        try:
            db.execute("PRAGMA journal_mode=WAL")
            with db:
                yield db
        finally:
            db.close()

    def save(self, job: dict):
        with self.lock, self.connect() as db:
            db.execute("INSERT INTO jobs(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data", (job["id"], json.dumps(job)))

    def get(self, job_id: str):
        with self.lock, self.connect() as db:
            row = db.execute("SELECT data FROM jobs WHERE id=?", (job_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def all(self):
        with self.lock, self.connect() as db:
            rows = db.execute("SELECT data FROM jobs").fetchall()
        return sorted((json.loads(row[0]) for row in rows), key=lambda j: j["created_at"], reverse=True)
