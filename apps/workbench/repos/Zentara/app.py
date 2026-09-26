"""A local PDF assistant with lazy provider access and bounded per-session conversations."""
from __future__ import annotations

import streamlit as st

MAX_QUESTION_CHARS = 2000
MAX_HISTORY_MESSAGES = 12
MAX_ANSWER_CHARS = 12000
CONFIG_HELP = (
    "Set up the selected chat and embedding providers in your environment or local .env. "
    "See .env.example for the required keys and settings, then restart the app. "
    "Keep keys private; do not paste them into chat."
)
REQUEST_HELP = (
    "The document search could not finish. Check the selected providers' credentials, "
    "model access, billing and quota, and your network connection. "
    "Also check that data/ contains readable PDFs. Retry after correcting the problem."
)


def init_session_state() -> None:
    st.session_state.setdefault("messages", [])
    st.session_state.setdefault("chat_history", [])
    st.session_state.messages = st.session_state.messages[-MAX_HISTORY_MESSAGES:]
    st.session_state.chat_history = st.session_state.chat_history[-MAX_HISTORY_MESSAGES:]


def render_message(message) -> None:
    with st.chat_message(message["role"]):
        # Render untrusted documents and model output as text, never remote images or HTML.
        st.text(message["content"])
        if message.get("sources"):
            with st.expander("Sources cited in this answer"):
                for source in message["sources"]:
                    st.text(f"[{source['label']}] {source['source']} — page {source['page']}")
                    st.text(source["snippet"])
        if message.get("used_fallback"):
            st.caption("The primary chat provider was unavailable; this answer used NVIDIA fallback.")
        if message.get("citation_status") == "rejected":
            st.caption("The generated answer was withheld because its source citations could not be verified.")


def render_chat(build_rag_chain, ready: bool) -> None:
    for message in st.session_state.messages:
        render_message(message)
    if not st.session_state.messages:
        st.info("Ask a factual question supported by the PDFs shown in the sidebar. Answers cite the retrieved pages. If the PDFs do not contain an answer, Zentara will say it does not know.")
    prompt = st.chat_input(
        "Ask about your local PDFs…", key="question", max_chars=MAX_QUESTION_CHARS,
        disabled=not ready, submit_mode="disable",
    )
    if not prompt or not ready:
        return
    prompt = prompt.strip()
    if not prompt or len(prompt) > MAX_QUESTION_CHARS:
        st.warning(f"Enter a question of at most {MAX_QUESTION_CHARS} characters.")
        return
    user_message = {"role": "user", "content": prompt}
    render_message(user_message)
    try:
        # The ingestion layer persists/reuses immutable indexes. No global Streamlit cache
        # or mutable LLM resource is shared between users.
        with st.spinner("Searching your documents…"):
            chain, _ = build_rag_chain()
            result = chain.invoke({"input": prompt, "chat_history": st.session_state.chat_history})
        answer = str(result["answer"])[:MAX_ANSWER_CHARS]
        assistant_message = {
            "role": "assistant", "content": answer, "sources": result.get("sources", []),
            "used_fallback": result.get("used_fallback", False),
            "citation_status": result.get("citation_status"),
        }
        from langchain_core.messages import AIMessage, HumanMessage
        st.session_state.chat_history = (
            st.session_state.chat_history + [HumanMessage(content=prompt), AIMessage(content=answer)]
        )[-MAX_HISTORY_MESSAGES:]
    except Exception:
        # Provider exception bodies can contain credentials; never show or log them.
        assistant_message = {"role": "assistant", "content": REQUEST_HELP}
    render_message(assistant_message)
    st.session_state.messages = (
        st.session_state.messages + [user_message, assistant_message]
    )[-MAX_HISTORY_MESSAGES:]


def main() -> None:
    st.set_page_config(page_title="Zentara document assistant", page_icon=":material/menu_book:", layout="wide")
    init_session_state()
    st.title("Zentara document assistant")
    st.caption("Answers grounded in the PDFs in your local data/ folder. The most recent six turns support follow-up questions.")
    st.sidebar.title("Your knowledge base")
    st.sidebar.caption("Local PDFs; text is sent to your configured AI providers when you ask a question or build an index.")
    st.sidebar.caption("The original bundled PDFs are fictional demonstration documents. Replace data/ with your own PDFs for real use.")
    if st.sidebar.button("Clear conversation", key="clear_chat"):
        st.session_state.messages = []
        st.session_state.chat_history = []
    try:
        import config
        from ingest import list_source_documents
        from rag import build_rag_chain
        documents = list_source_documents()
    except Exception:
        st.warning("The app configuration or dependencies need attention. " + CONFIG_HELP)
        st.chat_input("Configure the app to ask about PDFs…", key="question", disabled=True)
        return
    st.sidebar.subheader("Documents")
    for document in documents:
        st.sidebar.text(document)
    ready = True
    try:
        config.validate_config()
    except Exception:
        ready = False
        st.warning(CONFIG_HELP)
    if not documents:
        ready = False
        st.info("Add readable PDF files to data/, then refresh this page. No index or provider calls are made until you ask a question or rebuild the index.")
    chat_provider = config.CHAT_PROVIDER if config.CHAT_PROVIDER in {"gemini", "nvidia", "groq"} else "invalid setting"
    embedding_provider = config.EMBEDDING_PROVIDER if config.EMBEDDING_PROVIDER in {"gemini", "nvidia"} else "invalid setting"
    st.sidebar.caption(f"Chat: {chat_provider} · Embeddings: {embedding_provider}")
    if st.sidebar.button("Rebuild document index", key="rebuild_index", disabled=not ready) and ready:
        try:
            with st.spinner("Rebuilding the document index…"):
                build_rag_chain(force_rebuild=True)
            st.success("Document index rebuilt. New questions will use the updated PDFs.")
        except Exception:
            st.error("The document index could not be rebuilt. The previous index was preserved. " + REQUEST_HELP)
    render_chat(build_rag_chain, ready)


if __name__ == "__main__":
    main()
