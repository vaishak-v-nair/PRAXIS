from pathlib import Path
from types import ModuleType, SimpleNamespace

from streamlit.testing.v1 import AppTest

import app

APP_PATH = Path(__file__).resolve().parents[1] / "app.py"


def setup_modules(monkeypatch, *, configured=True, documents=None, fail=False):
    import sys

    config = ModuleType("config")
    config.CHAT_PROVIDER = "gemini"
    config.EMBEDDING_PROVIDER = "gemini"

    def validate():
        if not configured:
            raise ValueError("SECRET_IN_EXCEPTION_MUST_NOT_RENDER")

    config.validate_config = validate
    ingest = ModuleType("ingest")
    ingest.list_source_documents = lambda: ["guide.pdf"] if documents is None else documents
    rag = ModuleType("rag")
    builds = []

    def build(force_rebuild=False):
        builds.append(force_rebuild)
        if fail:
            raise RuntimeError("SECRET_IN_EXCEPTION_MUST_NOT_RENDER")
        return SimpleNamespace(invoke=lambda _: {
            "answer": "The warranty lasts twelve months. [S1]", "used_fallback": True,
            "sources": [{"label": "S1", "source": "guide.pdf", "page": 1,
                         "snippet": "Warranty: twelve months."}], "citation_status": "valid"}), None

    rag.build_rag_chain = build
    for name, module in [("config", config), ("ingest", ingest), ("rag", rag)]:
        monkeypatch.setitem(sys.modules, name, module)
    return builds


def displayed(at):
    return "\n".join(str(element.value) for kind in ["text", "warning", "error", "caption"]
                     for element in at.get(kind))


def test_missing_keys_is_safe_and_never_initializes_index(monkeypatch):
    builds = setup_modules(monkeypatch, configured=False)
    at = AppTest.from_file(str(APP_PATH), default_timeout=15).run()
    assert not at.exception
    assert at.warning
    assert at.chat_input[0].disabled
    assert "SECRET_IN_EXCEPTION" not in displayed(at)
    assert ".env.example" in displayed(at)
    assert not builds


def test_no_documents_is_clear_and_does_not_call_provider(monkeypatch):
    builds = setup_modules(monkeypatch, documents=[])
    at = AppTest.from_file(str(APP_PATH), default_timeout=15).run()
    assert not at.exception
    assert at.chat_input[0].disabled
    assert any("Add readable PDF" in item.value for item in at.info)
    assert not builds


def test_provider_failure_has_actionable_message_without_secret(monkeypatch):
    builds = setup_modules(monkeypatch, fail=True)
    at = AppTest.from_file(str(APP_PATH), default_timeout=15).run()
    assert not builds
    at.chat_input[0].set_value("What is the warranty?").run()
    assert not at.exception
    assert "billing and quota" in displayed(at)
    assert "SECRET_IN_EXCEPTION" not in displayed(at)
    assert len(at.session_state["messages"]) == 2
    assert at.session_state["chat_history"] == []


def test_rebuild_is_one_shot_and_does_not_clear_other_sessions(monkeypatch):
    builds = setup_modules(monkeypatch)
    at = AppTest.from_file(str(APP_PATH), default_timeout=15).run()
    assert not builds
    at.button(key="rebuild_index").click().run()
    assert not at.exception
    assert builds == [True]
    at.run()
    assert builds == [True]
    assert not at.exception


def test_answers_show_honest_sources_and_conversation_stays_bounded(monkeypatch):
    from langchain_core.messages import AIMessage, HumanMessage

    setup_modules(monkeypatch)
    at = AppTest.from_file(str(APP_PATH), default_timeout=15)
    history = []
    messages = []
    for index in range(20):
        history.extend([HumanMessage(content=f"Question {index}"), AIMessage(content="Answer")])
        messages.extend([{"role": "user", "content": f"Question {index}"},
                         {"role": "assistant", "content": "Answer"}])
    at.session_state["messages"] = messages
    at.session_state["chat_history"] = history
    at.run()
    at.chat_input[0].set_value("Warranty?").run()
    assert not at.exception
    assert "[S1] guide.pdf" in displayed(at)
    assert "page 1" in displayed(at)
    assert "NVIDIA fallback" in displayed(at)
    assert len(at.session_state["messages"]) == app.MAX_HISTORY_MESSAGES
    assert len(at.session_state["chat_history"]) == app.MAX_HISTORY_MESSAGES
    at.button(key="clear_chat").click().run()
    assert not at.exception
    assert at.session_state["messages"] == []
    assert at.session_state["chat_history"] == []

