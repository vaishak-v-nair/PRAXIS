"""Application configuration loaded from environment variables."""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parent
DATA_DIR = ROOT_DIR / "data"
CHROMA_DIR = ROOT_DIR / "chroma_db"

load_dotenv(ROOT_DIR / ".env")

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
NVIDIA_API_KEY = (os.getenv("NVIDIA_API_KEY") or os.getenv("NVIDIA_NIM_KEY", "")).strip()
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip()
CHAT_PROVIDER = os.getenv("CHAT_PROVIDER", "groq").strip().lower()
EMBEDDING_PROVIDER = os.getenv("EMBEDDING_PROVIDER", "gemini").strip().lower()
NIM_MODEL = os.getenv("NIM_MODEL", "meta/llama-3.1-8b-instruct").strip()
GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b").strip()
GROQ_REASONING_EFFORT = os.getenv("GROQ_REASONING_EFFORT", "low").strip().lower()


def bounded_int(name: str, default: int, minimum: int, maximum: int) -> int:
    """Parse bounded values without exposing the environment value in errors."""
    try:
        value = int(os.getenv(name, str(default)))
    except (ValueError, TypeError):
        raise ValueError(f"{name} must be an integer between {minimum} and {maximum}.") from None
    if not minimum <= value <= maximum:
        raise ValueError(f"{name} must be between {minimum} and {maximum}.")
    return value


def strict_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name, str(default)).strip().lower()
    if value not in {"true", "false"}:
        raise ValueError(f"{name} must be true or false.")
    return value == "true"


ENABLE_NIM_FALLBACK = strict_bool("ENABLE_NIM_FALLBACK")
TOP_K = bounded_int("TOP_K", 4, 1, 20)
CHUNK_SIZE = bounded_int("CHUNK_SIZE", 1000, 100, 10000)
CHUNK_OVERLAP = bounded_int("CHUNK_OVERLAP", 200, 0, 9999)
REQUEST_TIMEOUT = bounded_int("REQUEST_TIMEOUT", 60, 5, 120)
MAX_OUTPUT_TOKENS = bounded_int("MAX_OUTPUT_TOKENS", 4096, 256, 8192)
MAX_ATTEMPTS = bounded_int("MAX_ATTEMPTS", 3, 1, 3)
MAX_PDF_FILES = bounded_int("MAX_PDF_FILES", 100, 1, 1000)
MAX_PDF_MB = bounded_int("MAX_PDF_MB", 25, 1, 100)
MAX_PDF_PAGES = bounded_int("MAX_PDF_PAGES", 500, 1, 2000)
MAX_TOTAL_PAGES = bounded_int("MAX_TOTAL_PAGES", 2000, 1, 10000)
MAX_TEXT_CHARS = bounded_int("MAX_TEXT_CHARS", 10000000, 1000, 50000000)
MAX_CHUNKS = bounded_int("MAX_CHUNKS", 20000, 1, 100000)

EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "nvidia/nv-embedqa-e5-v5" if EMBEDDING_PROVIDER == "nvidia" else "models/gemini-embedding-001").strip()
LLM_MODEL = os.getenv("GEMINI_MODEL", os.getenv("LLM_MODEL", "gemini-3.1-pro-preview")).strip()

def validate_config() -> None:
    """Raise a clear error if required configuration is missing."""
    if CHAT_PROVIDER not in {"gemini", "nvidia", "groq"}:
        raise ValueError("CHAT_PROVIDER must be gemini, nvidia, or groq.")
    if EMBEDDING_PROVIDER not in {"gemini", "nvidia"}:
        raise ValueError("EMBEDDING_PROVIDER must be gemini or nvidia.")
    if GROQ_REASONING_EFFORT not in {"low", "medium", "high"}:
        raise ValueError("GROQ_REASONING_EFFORT must be low, medium, or high.")
    if CHUNK_OVERLAP >= CHUNK_SIZE:
        raise ValueError("CHUNK_OVERLAP must be smaller than CHUNK_SIZE.")
    for name, value in {"GEMINI_MODEL": LLM_MODEL, "NIM_MODEL": NIM_MODEL,
                        "GROQ_MODEL": GROQ_MODEL, "EMBEDDING_MODEL": EMBEDDING_MODEL}.items():
        if not value or len(value) > 200 or any(c.isspace() for c in value):
            raise ValueError(f"{name} must be a nonempty model identifier without whitespace.")
    missing = []
    if (CHAT_PROVIDER == "gemini" or EMBEDDING_PROVIDER == "gemini") and not GEMINI_API_KEY:
        missing.append("GEMINI_API_KEY")
    if (CHAT_PROVIDER == "nvidia" or EMBEDDING_PROVIDER == "nvidia" or ENABLE_NIM_FALLBACK) and not NVIDIA_API_KEY:
        missing.append("NVIDIA_API_KEY (or NVIDIA_NIM_KEY)")
    if CHAT_PROVIDER == "groq" and not GROQ_API_KEY:
        missing.append("GROQ_API_KEY")
    if missing:
        raise ValueError(
            "Missing required environment variables: "
            + ", ".join(missing)
            + ". Copy .env.example to .env and add your keys."
        )


def has_nim_fallback() -> bool:
    return ENABLE_NIM_FALLBACK and bool(NVIDIA_API_KEY)
