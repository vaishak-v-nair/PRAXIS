# Zentara

A local Streamlit assistant that answers questions from PDFs in `data/` and shows retrieved source pages. The five bundled documents describe the fictional Zentara Robotics company for demonstration; replace them with your own PDFs for real use. This repaired copy was pressure tested through ReGen from `https://github.com/vaishak-v-nair/Zentara.git`. The upstream repository has not been changed.

## Run

Use Python 3.12. From this directory on Windows:

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
Copy-Item .env.example .env
# Set GROQ_API_KEY and GEMINI_API_KEY in .env.
.venv\Scripts\python.exe -m streamlit run app.py --server.address 127.0.0.1
```

On macOS/Linux, use `.venv/bin/python`. Open the local URL printed by Streamlit. The default chat model is Groq `openai/gpt-oss-120b`; embeddings use Gemini `models/gemini-embedding-001`. Both keys are required for the default setup. Selected providers are explicit; a missing key produces an actionable error. Optional Gemini chat and NVIDIA chat/embeddings are configured in `.env.example`; availability depends on account access. An enabled NVIDIA fallback runs only for transient primary errors, and the UI marks its actual use. Permanent credential/model errors require correction.

Never commit `.env`, indexes, private documents, or API credentials. Questions, recent conversation, and retrieved excerpts are sent to the chat provider; document chunks are sent to the embedding provider.

## Behavior and limits

The app uses a local SQLite vector index with normalized cosine retrieval and JSON metadata. It loads the index on the first question or explicit rebuild. Fingerprints include PDF contents, embedding provider/model, storage engine, and chunk settings. Changed, added, or removed PDFs trigger a new index. Builds run under a cross-process lock and publish a manifest atomically only after validation; an unsuccessful build preserves the previous version. Versions are retained so live sessions can finish against their existing snapshot. Stop all sessions before manually removing unused `chroma_db/versions/` directories; the directory keeps its legacy name and retained versions consume disk space. ChromaDB packages and executable model-artifact loading have been removed. Old indexes are preserved but not reused by the new storage engine.

Questions are limited to 2,000 characters, conversation to six recent turns, retrieved context to 20,000 characters, and rendered answers to 12,000 characters. PDF file size, pages, total text, chunk count, output tokens, retries, and request timeouts have validated bounds. Oversized, encrypted, unreadable, or textless PDFs produce safe errors. Scanned image documents require OCR before ingestion.

Citation labels are validated against actual retrieved excerpts; fabricated or missing citations cause the response to be rejected. Page indexes are converted to human page numbers. Excerpts are rendered as text. These checks validate source references, not the truth of every generated claim; inspect the displayed evidence for consequential decisions. Prompts treat documents and conversation as untrusted data, but prompt instructions alone cannot prove resistance to every injection.

This application is intended for one trusted local operator. It has no user authentication, tenant isolation, or document authorization system. Add those boundaries and operational review before exposing it as a shared service.

## Development gates

```powershell
.venv\Scripts\python.exe -m ruff check .
.venv\Scripts\python.exe -m pytest
.venv\Scripts\python.exe -m pip check
```

Offline tests exercise real PDF extraction, SQLite persistence/ranking, invalid index schemas/vectors, failed and concurrent rebuilds, provider retry boundaries, fallback provenance, input limits, citation handling, and Streamlit session behavior. They never require keys or network access. GitHub Actions runs these checks on Windows and Linux. Live API pressure testing is recorded separately by ReGen, rather than inferred from mocks.

`requirements-resolved.txt` records the complete tested Python 3.12 Windows environment, including development and transitive packages. Direct dependencies are pinned in the install files. Cross-platform CI is provided; it has not been run remotely from this local copy.

Read [AGENTS.md](AGENTS.md) before changing code. `handson.md` preserves the original exercise; this README describes the implemented application.
