"""Rate-limited provider keys are parked and Bokito models fail over."""

import pytest

from app.models.auth import Tenant
from app.services import model_resolution, platform_secrets, provider_health
from app.services.agent.llm import is_hard_quota_error, with_rate_limit_retry
from app.services.model_catalog import seed_model_catalog
from app.services.model_resolution import resolve_model_call


class _Headers(dict):
    def get(self, key, default=None):  # case-insensitive like httpx.Headers
        return super().get(key.lower(), default)


class _Response:
    def __init__(self, headers: dict[str, str]) -> None:
        self.headers = _Headers({k.lower(): v for k, v in headers.items()})


class _RateLimit(Exception):
    def __init__(self, headers: dict[str, str] | None = None) -> None:
        super().__init__("Error code: 429 - Rate limit exceeded")
        self.status_code = 429
        self.response = _Response(headers or {})


_RateLimit.__name__ = "RateLimitError"


@pytest.fixture(autouse=True)
def _clean_health():
    provider_health.reset()
    yield
    provider_health.reset()


def test_hard_quota_detected_from_zero_limit_header():
    assert is_hard_quota_error(_RateLimit({"x-ratelimit-limit-req-minute": "0"})) is True
    assert is_hard_quota_error(_RateLimit({"x-ratelimit-limit-req-minute": "60"})) is False
    assert is_hard_quota_error(RuntimeError("boom")) is False


def test_claude_5_uses_adaptive_thinking():
    from app.services.agent.llm import AnthropicLLMProvider, _learn_adaptive_thinking

    def build(model: str) -> dict:
        return AnthropicLLMProvider._create_kwargs(
            model=model, system="", chat_messages=[], tools=None,
            thinking_budget=4096, max_tokens=None,
        )

    new = build("claude-sonnet-5-5")
    assert new["thinking"] == {"type": "adaptive"}
    assert new["output_config"] == {"effort": "medium"}

    old = build("claude-sonnet-4-6")
    assert old["thinking"] == {"type": "enabled", "budget_tokens": 4096}
    assert "output_config" not in old

    err = Exception('"thinking.type.enabled" is not supported for this model. Use "thinking.type.adaptive"')
    assert _learn_adaptive_thinking(err, "claude-opus-4-8") is True
    assert build("claude-opus-4-8")["thinking"] == {"type": "adaptive"}


@pytest.mark.asyncio
async def test_hard_quota_skips_retries_and_parks_key(monkeypatch):
    sleeps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)

    monkeypatch.setattr("app.services.agent.llm.asyncio.sleep", fake_sleep)
    calls = {"n": 0}

    async def blocked() -> str:
        calls["n"] += 1
        raise _RateLimit({"x-ratelimit-limit-req-minute": "0"})

    with pytest.raises(_RateLimit):
        await with_rate_limit_retry(
            blocked, label="t", provider="mistral", api_key="mi-key", model="mistral-medium-latest"
        )
    assert calls["n"] == 1
    assert sleeps == []
    assert provider_health.is_cooling("mi-key", "mistral-medium-latest") is True
    # Limits are per model: the same key stays usable for other models.
    assert provider_health.is_cooling("mi-key", "ministral-8b-latest") is False
    assert provider_health.is_cooling("other-key", "mistral-medium-latest") is False


def test_plan_refusal_counts_as_hard_failure():
    from app.services.agent.llm import is_hard_failure, should_fail_over

    class _Forbidden(Exception):
        status_code = 403

    exc = _Forbidden("Error code: 403 - This model is not available in your subscription tier")
    assert should_fail_over(exc) is True
    assert is_hard_failure(exc) is True
    assert should_fail_over(_Forbidden("Error code: 403 - invalid api key")) is False


@pytest.mark.asyncio
async def test_parked_model_falls_to_next_model_on_same_key(session_override, monkeypatch):
    monkeypatch.setattr(model_resolution.settings, "llm_mode", "mock")
    monkeypatch.setattr(model_resolution.settings, "mistral_api_key", "")
    monkeypatch.setattr(model_resolution.settings, "bokito_backings", "")
    await seed_model_catalog(session_override)
    tenant = Tenant(slug="failover-model", name="Failover Model")
    session_override.add(tenant)
    await session_override.commit()
    await session_override.refresh(tenant)
    await platform_secrets.set_platform_secret(session_override, "mistral", "mi-one")

    first = await resolve_model_call(session_override, tenant.id, kind="chat")
    assert first.model_id == "mistral-medium-latest"
    provider_health.mark_rate_limited("mistral", "mi-one", first.model_id, hard_quota=True)
    second = await resolve_model_call(session_override, tenant.id, kind="chat")
    assert second.api_key == "mi-one"
    assert second.model_id != "mistral-medium-latest"
    assert second.fallback_active is True


@pytest.mark.asyncio
async def test_resolver_skips_parked_mistral_key(session_override, monkeypatch):
    monkeypatch.setattr(model_resolution.settings, "llm_mode", "mock")
    monkeypatch.setattr(model_resolution.settings, "anthropic_api_key", "")
    monkeypatch.setattr(model_resolution.settings, "mistral_api_key", "")
    monkeypatch.setattr(model_resolution.settings, "openai_api_key", "")
    await seed_model_catalog(session_override)
    tenant = Tenant(slug="failover-a", name="Failover A")
    session_override.add(tenant)
    await session_override.commit()
    await session_override.refresh(tenant)
    await platform_secrets.set_platform_secret(session_override, "mistral", "mi-dead")
    await platform_secrets.set_platform_secret(session_override, "anthropic", "sk-ant-live")

    # Every step parked: stay on the primary so the provider error surfaces.
    monkeypatch.setattr(model_resolution.settings, "bokito_backings", "")
    for model in ("mistral-medium-latest", "mistral-large-4", "mistral-small-latest"):
        provider_health.mark_rate_limited("mistral", "mi-dead", model, hard_quota=True)
    stuck = await resolve_model_call(session_override, tenant.id, kind="chat")
    assert stuck.model_id == "mistral-medium-latest"
    provider_health.reset()

    monkeypatch.setattr(
        model_resolution.settings,
        "bokito_backings",
        '{"bokito-ai-3-1": ["mistral-medium-latest", "claude-sonnet-5-5"]}',
    )
    primary = await resolve_model_call(session_override, tenant.id, kind="chat")
    assert primary.provider_type == "mistral"

    provider_health.mark_rate_limited("mistral", "mi-dead", primary.model_id, hard_quota=True)
    fallback = await resolve_model_call(session_override, tenant.id, kind="chat")
    assert fallback.provider_type == "anthropic"
    assert fallback.api_key == "sk-ant-live"
    assert fallback.slug == "bokito-ai-3-1"
    assert fallback.fallback_active is True

    provider_health.reset()
    again = await resolve_model_call(session_override, tenant.id, kind="chat")
    assert again.provider_type == "mistral"


@pytest.mark.asyncio
async def test_agent_loop_finishes_turn_on_fallback(session_override, monkeypatch):
    from app.services.agent import loop as loop_mod
    from app.services.model_resolution import ResolvedModelCall

    def _call(provider: str, key: str) -> ResolvedModelCall:
        return ResolvedModelCall(
            slug="bokito-ai-3-1",
            provider="bokito",
            provider_type=provider,
            model_id=f"{provider}-model",
            kind="chat",
            api_key=key,
            key_source="platform",
        )

    class _Dead:
        async def chat(self, *_a, **_k):
            raise _RateLimit({"x-ratelimit-limit-req-minute": "0"})

    class _Alive:
        async def chat(self, *_a, **_k):
            return {"content": [{"type": "text", "text": "hi"}], "stop_reason": "end_turn"}

    async def fake_resolve(*_a, **_k):
        return _call("anthropic", "sk-ant")

    monkeypatch.setattr("app.services.model_resolution.resolve_model_call", fake_resolve)
    monkeypatch.setattr(loop_mod, "get_chat_provider", lambda *_a, **_k: _Alive())

    runner = loop_mod.AgentLoop.__new__(loop_mod.AgentLoop)
    runner.session = session_override
    runner.tenant_id = None
    runner.agent = None
    runner.model_override = None
    runner.task_hint = None
    runner.tools = []
    runner.thinking_budget = 0
    runner.resolved_call = _call("mistral", "mi-dead")
    runner.llm = _Dead()

    response = await runner._llm_chat([{"role": "user", "content": "hello"}], 256)
    assert response["content"][0]["text"] == "hi"
    assert runner.resolved_call.provider_type == "anthropic"
    assert provider_health.is_cooling("mi-dead", "mistral-model") is True
