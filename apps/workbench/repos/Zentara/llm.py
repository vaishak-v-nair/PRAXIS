"""Bounded provider calls with explicit, per-response fallback provenance."""
from __future__ import annotations

import logging
import time
from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import BaseMessage
from langchain_core.outputs import ChatGeneration, ChatResult
from pydantic import Field

import config

logger = logging.getLogger(__name__)


def is_transient(error: Exception, _depth: int = 0) -> bool:
    """Retry only connection/timeouts, rate limits, and service failures."""
    status = getattr(error, "status_code", None)
    if status is None:
        status = getattr(getattr(error, "response", None), "status_code", None)
    code = getattr(error, "code", None)
    if status is None and isinstance(code, int):
        status = code
    if status is not None:
        return status in {408, 429, 500, 502, 503, 504}
    cause = getattr(error, "__cause__", None)
    if isinstance(cause, Exception) and cause is not error and _depth < 4:
        return is_transient(cause, _depth + 1)
    return isinstance(error, (TimeoutError, ConnectionError)) or type(error).__name__ in {
        "ConnectError", "ReadError", "WriteError", "RemoteProtocolError",
        "ReadTimeout", "ConnectTimeout", "WriteTimeout", "PoolTimeout", "APITimeoutError",
        "APIConnectionError", "ResourceExhausted", "ServiceUnavailable", "DeadlineExceeded",
    }


class FallbackChatModel(BaseChatModel):
    """Use the providers' public invoke API; never expose upstream error bodies."""

    primary: BaseChatModel
    fallback: BaseChatModel | None = None
    provider: str = "gemini"
    fallback_provider: str = "nvidia"
    max_attempts: int = Field(default=3, ge=1, le=3)

    @property
    def _llm_type(self) -> str:
        return "zentara-bounded-chat"

    def _call(self, model, messages, stop, kwargs):
        for attempt in range(self.max_attempts):
            try:
                return model.invoke(messages, stop=stop, **kwargs), attempt + 1
            except Exception as error:
                transient = is_transient(error)
                logger.warning("Provider request failed: category=%s attempt=%s", "transient" if transient else "permanent", attempt + 1)
                if not transient or attempt + 1 >= self.max_attempts:
                    raise
                time.sleep(min(2 ** attempt, 4))
        raise RuntimeError("Provider attempts exhausted.")

    def _generate(self, messages: list[BaseMessage], stop: list[str] | None = None,
                  run_manager=None, **kwargs: Any) -> ChatResult:
        try:
            response, attempts = self._call(self.primary, messages, stop, kwargs)
            used_fallback = False
            provider = self.provider
        except Exception as error:
            # Configuration/authentication errors need correction, not silent fallback.
            if self.fallback is None or not is_transient(error):
                raise RuntimeError("Chat provider request failed. Check provider access, credentials, quota, and model settings.") from None
            try:
                response, attempts = self._call(self.fallback, messages, stop, kwargs)
                used_fallback = True
                provider = self.fallback_provider
            except Exception:
                raise RuntimeError("Both chat providers failed. Check provider access and quota; retry later.") from None
        response = response.model_copy(deep=True)
        response.response_metadata.update({"provider": provider, "used_fallback": used_fallback,
                                          "regen_used_fallback": used_fallback, "attempts": attempts})
        selected = self.fallback if used_fallback else self.primary
        response.response_metadata["model"] = getattr(selected, "model", getattr(selected, "model_name", "configured-model"))
        return ChatResult(generations=[ChatGeneration(message=response)])

    @property
    def _identifying_params(self) -> dict[str, Any]:
        return {"provider": self.provider}


def _provider_model(provider: str) -> BaseChatModel:
    if provider == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(model=config.LLM_MODEL, temperature=0,
                                      google_api_key=config.GEMINI_API_KEY,
                                      max_output_tokens=config.MAX_OUTPUT_TOKENS,
                                      timeout=config.REQUEST_TIMEOUT, max_retries=0)
    if provider == "nvidia":
        # The native adapter does not forward all timeout/retry constructor options.
        # NIM's documented OpenAI endpoint exposes explicit bounded requests.
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(model=config.NIM_MODEL, api_key=config.NVIDIA_API_KEY,
                          base_url="https://integrate.api.nvidia.com/v1", temperature=0,
                          max_tokens=config.MAX_OUTPUT_TOKENS,
                          timeout=config.REQUEST_TIMEOUT, max_retries=0)
    from langchain_openai import ChatOpenAI
    # Groq documents these exact GPT-OSS models as accepting low/medium/high.
    # Bound reasoning for factual retrieval so final answers fit the token budget.
    reasoning = {"reasoning_effort": config.GROQ_REASONING_EFFORT} if config.GROQ_MODEL in {
        "openai/gpt-oss-120b", "openai/gpt-oss-20b"
    } else {}
    return ChatOpenAI(model=config.GROQ_MODEL, api_key=config.GROQ_API_KEY,
                      base_url="https://api.groq.com/openai/v1", temperature=0,
                      max_tokens=config.MAX_OUTPUT_TOKENS,
                      timeout=config.REQUEST_TIMEOUT, max_retries=0, **reasoning)


def get_chat_model() -> FallbackChatModel:
    config.validate_config()
    try:
        primary = _provider_model(config.CHAT_PROVIDER)
        fallback = _provider_model("nvidia") if config.CHAT_PROVIDER != "nvidia" and config.has_nim_fallback() else None
    except Exception:
        raise RuntimeError("Cannot initialize chat provider. Check configured model, credentials, and installed provider packages.") from None
    return FallbackChatModel(primary=primary, fallback=fallback, provider=config.CHAT_PROVIDER,
                             max_attempts=config.MAX_ATTEMPTS)
