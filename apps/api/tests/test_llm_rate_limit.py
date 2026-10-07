"""LLM provider retries and user-facing copy for gateway 429s."""

import pytest

from app.services.agent.llm import is_rate_limit_error, with_rate_limit_retry
from app.services.run_errors import (
    BLOCK_RATE_LIMIT,
    LLM_RATE_LIMIT_BACKOFF_MINUTES,
    active_workspace_block,
    open_workspace_block,
    workspace_block,
)


class _FakeRateLimit(Exception):
    """Stand-in for openai.RateLimitError without importing the SDK."""

    def __init__(self, message: str = "Error code: 429 - Rate limit exceeded") -> None:
        super().__init__(message)
        self.status_code = 429


_FakeRateLimit.__name__ = "RateLimitError"


def test_is_rate_limit_error_detects_platform_code_1300():
    exc = Exception(
        "Error code: 429 - {'object': 'error', 'message': 'Rate limit exceeded', "
        "'type': 'rate_limited', 'param': None, 'code': '1300', 'raw_status_code': 429}"
    )
    assert is_rate_limit_error(exc) is True
    assert workspace_block(exc) == BLOCK_RATE_LIMIT


def test_is_rate_limit_error_detects_sdk_classname():
    assert is_rate_limit_error(_FakeRateLimit()) is True


def test_is_rate_limit_error_ignores_other_failures():
    assert is_rate_limit_error(RuntimeError("connection reset")) is False
    assert workspace_block(RuntimeError("connection reset")) is None


@pytest.mark.asyncio
async def test_with_rate_limit_retry_succeeds_after_429(monkeypatch):
    sleeps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    monkeypatch.setattr("app.services.agent.llm.asyncio.sleep", fake_sleep)

    calls = {"n": 0}

    async def flaky() -> str:
        calls["n"] += 1
        if calls["n"] < 3:
            raise _FakeRateLimit()
        return "ok"

    assert await with_rate_limit_retry(flaky, label="test") == "ok"
    assert calls["n"] == 3
    assert sleeps == [1.0, 2.0]


@pytest.mark.asyncio
async def test_with_rate_limit_retry_gives_up(monkeypatch):
    async def fake_sleep(_seconds: float) -> None:
        return None

    monkeypatch.setattr("app.services.agent.llm.asyncio.sleep", fake_sleep)

    async def always_429() -> str:
        raise _FakeRateLimit()

    with pytest.raises(_FakeRateLimit):
        await with_rate_limit_retry(always_429, label="test")


def test_rate_limit_block_uses_short_backoff():
    from app.models.auth import Tenant

    tenant = Tenant(name="Rate", slug="rate-limit-test")
    tenant.settings_json = "{}"
    open_workspace_block(tenant, kind=BLOCK_RATE_LIMIT, error=_FakeRateLimit())
    block = active_workspace_block(tenant)
    assert block is not None
    assert block["kind"] == BLOCK_RATE_LIMIT
    from datetime import datetime

    until = datetime.fromisoformat(block["until"])
    since = datetime.fromisoformat(block["since"])
    assert (until - since).total_seconds() == pytest.approx(
        LLM_RATE_LIMIT_BACKOFF_MINUTES * 60, abs=2
    )


def test_agent_error_message_mentions_rate_limit():
    from app.routers.signal_chat import _agent_error_message

    text = _agent_error_message(_FakeRateLimit(), {"llm_configured": True})
    assert "rate limit" in text.lower()
    assert "try again" in text.lower() or "send your message again" in text.lower()
