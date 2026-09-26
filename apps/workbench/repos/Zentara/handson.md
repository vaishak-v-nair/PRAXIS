# Hands-On: Build a Basic RAG Chatbot

Your goal is to build a working **RAG (Retrieval-Augmented Generation)** chatbot that can
answer questions grounded in a small set of PDF documents. This mirrors the reference
project you have in this folder.

You may use any coding agent you like (Claude Code, OpenAI Codex, GitHub Copilot, Cursor,
Gemini CLI, opencode, etc.) — the point is the *engineering decisions*, not the tool.

## Before you start

- You need a Gemini API key. Add it to a `.env` file:
  ```env
  GEMINI_API_KEY='your-key-here'
  ```
- Use **Python 3.11** and create a virtual environment:
  ```bash
  python3.11 -m venv .venv
  ```
- Put 4–6 PDF documents (any subject) in a `data/` folder. The reference uses
  `01_*.pdf` … `05_*.pdf`.

## The base system to build

A minimal but complete RAG pipeline:

1. **Load** the PDFs from `data/`.
2. **Split** the text into chunks (e.g. ~1000 chars with ~200 overlap).
3. **Embed** the chunks and store them in a vector DB (e.g. Chroma).
4. **Retrieve** the top-k most relevant chunks for a user question.
5. **Generate** an answer with the LLM, using only the retrieved chunks as context.
6. Serve it through a simple UI (Streamlit is a good default).

### Suggested tech stack

| Concern       | Choice                                                         |
|---------------|----------------------------------------------------------------|
| LangChain     | `langchain`, `langchain-google-genai`, `langchain-classic`     |
| Embeddings    | `GoogleGenerativeAIEmbeddings` (e.g. `models/gemini-embedding-001`) |
| LLM           | `ChatGoogleGenerativeAI` (e.g. `gemini-3.5-flash-lite`)        |
| Vector store  | `langchain-chroma` (persist to `chroma_db/`)                   |
| PDF loading   | `PyPDFLoader` (`langchain-community`)                          |
| Splitting     | `RecursiveCharacterTextSplitter` (`langchain-text-splitters`)  |
| UI            | `streamlit`                                                    |

> Note: newer `langchain` (1.x) moved the chain builders (`create_retrieval_chain`,
> `create_history_aware_retriever`, `create_stuff_documents_chain`) into the
> `langchain-classic` package. Import from there if your version does.

## Requirements (the checklist to pass)

Your system must:

- [ ] Create a Python 3.11 venv and list dependencies in `requirements.txt`.
- [ ] Load the API key from `.env` (not hardcoded).
- [ ] Ingest the PDFs and persist embeddings to a Chroma store (build once, reuse on restart).
- [ ] Retrieve the top-k relevant chunks for a user question.
- [ ] Answer **only from the retrieved context** (say "I don't know" if not in context).
- [ ] Keep conversational history so follow-up questions work (e.g. "and what happens if it's missed?").
- [ ] Show which source document(s) each answer came from.
- [ ] Handle transient API errors gracefully (retry with backoff) instead of crashing.

## Suggested build steps

1. Scaffold the project and set up the venv + `.env`.
2. Get a single LLM call working (`ChatGoogleGenerativeAI.invoke`).
3. Add PDF loading → chunking → embedding → Chroma persistence. Verify the store was built.
4. Add retrieval (a `retriever` from the vector store) and test it returns relevant chunks.
5. Add the generation step with a context prompt; test a grounded answer end-to-end.
6. Wrap it in a Streamlit UI with chat history.
7. Verify with a mix of questions:
   - a factual "what is X?" question,
   - a "what does the doc say about Y?" question,
   - a follow-up that depends on earlier context.

## Verify it works

Run the app and ask questions that require the documents:

```bash
.venv/bin/streamlit run app.py
```

Confirm answers are grounded (they cite facts from your PDFs) and that "I don't know"
fires for questions outside the documents.

---

## Next steps (after the base system works)

Once your basic RAG is working and you can answer grounded questions, level it up.
Try these roughly in order of increasing sophistication:

### 1. Evaluation
- Build a small set of Q&A pairs from your documents (a "golden set").
- Measure **retrieval** quality (recall@k, MRR, hit rate) and **generation** quality.
- Use an LLM-as-a-judge to score groundedness, helpfulness, and faithfulness.
- Track these numbers before/after every change so you know if an improvement is real.

### 2. Chunking strategies
- Experiment with chunk size, overlap, and splitting methods
  (`RecursiveCharacterTextSplitter`, sentence-aware splitting, markdown/header-aware split).
- Try **semantic chunking** (split where meaning shifts, not at fixed sizes).
- Compare retrieval hit-rate across strategies.

### 3. Embeddings & hybrid search
- Try different embedding models and dimensionalities.
- Add a **keyword/BM25** retriever and **hybrid search** (dense + sparse, e.g. via a
  `EnsembleRetriever`) to combine semantic and lexical matching.
- Tune weights between dense and sparse results.

### 4. Reranking
- Retrieve more candidates (e.g. top-20) and **rerank** to the top-k with a cross-encoder
  or an LLM reranker (e.g. Cohere Rerank, or a Gemini/GPT rerank call).
- This often gives the biggest quality jump for minimal cost.

### 5. Query transformation
- **Query rewriting**: rephrase/multi-query expansion (`MultiQueryRetriever`).
- **HyDE** (hypothetical document embeddings): embed a generated answer instead of the query.
- **Self-query retrieval**: extract metadata filters from the question.

### 6. Document-level features
- Add metadata (title, page, section) and filter by it.
- Use **parent-document retrieval**: retrieve small chunks, return larger parent chunks as context.
- Handle tables, images, and scanned PDFs (OCR) if your docs contain them.

### 7. Production hardening
- Conversation-aware retrieval (already in the base) with session persistence.
- Streaming responses.
- Caching, rate limiting, and cost tracking.
- Guardrails: input/output moderation, citation links back to source chunks.