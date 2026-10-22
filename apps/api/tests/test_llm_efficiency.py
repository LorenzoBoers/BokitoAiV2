"""Prompt caching breakpoints, billing-equivalent usage and shared SDK clients."""

import asyncio
from types import SimpleNamespace

import pytest

from app.config import get_settings
from app.services.agent import llm_efficiency as eff
from app.services.agent.llm import AnthropicLLMProvider


def _kwargs():
    return {
        "model": "claude-x",
        "system": "You are Bokito.",
        "tools": [{"name": "a", "input_schema": {}}, {"name": "b", "input_schema": {}}],
        "messages": [
            {"role": "user", "content": "hoi"},
            {"role": "assistant", "content": [{"type": "text", "text": "ok"}]},
            {
                "role": "user",
                "content": [
                    {"type": "tool_result", "tool_use_id": "t1", "content": "done"},
                    {"type": "text", "text": ""},
                ],
            },
        ],
    }


def _breakpoints(kwargs) -> int:
    n = sum(1 for t in kwargs["tools"] if "cache_control" in t)
    n += sum(1 for b in kwargs["system"] if "cache_control" in b)
    for m in kwargs["messages"]:
        if isinstance(m["content"], list):
            n += sum(1 for b in m["content"] if "cache_control" in b)
    return n


def test_breakpoints_on_tools_system_and_last_message_without_mutation():
    original = _kwargs()
    out = eff.apply_prompt_caching(original)

    assert "cache_control" in out["tools"][-1] and "cache_control" not in out["tools"][0]
    assert out["system"] == [
        {"type": "text", "text": "You are Bokito.", "cache_control": {"type": "ephemeral"}}
    ]
    last = out["messages"][-1]["content"]
    # Empty trailing text is skipped; the tool_result carries the breakpoint.
    assert "cache_control" in last[0] and "cache_control" not in last[1]
    assert _breakpoints(out) == 3  # API limit is 4

    # Caller's structures are untouched (the agent loop reuses them).
    assert original == _kwargs()


def test_string_message_and_empty_inputs():
    out = eff.apply_prompt_caching({"system": "", "tools": [], "messages": [{"role": "user", "content": "x"}]})
    assert out["system"] == "" and out["tools"] == []
    assert out["messages"][0]["content"] == [
        {"type": "text", "text": "x", "cache_control": {"type": "ephemeral"}}
    ]


def test_caching_only_for_anthropic_hosts(monkeypatch):
    assert eff.prompt_caching_enabled(None)
    assert eff.prompt_caching_enabled("https://api.anthropic.com")
    assert not eff.prompt_caching_enabled("https://gateway.example.com/v1")
    monkeypatch.setattr(get_settings(), "llm_prompt_caching", False)
    assert not eff.prompt_caching_enabled(None)


def test_usage_is_billing_equivalent():
    usage = SimpleNamespace(
        input_tokens=100, output_tokens=50, cache_creation_input_tokens=1000, cache_read_input_tokens=10_000
    )
    out = eff.anthropic_usage(usage)
    assert out["input_tokens"] == 100 + 1250 + 1000
    assert out["output_tokens"] == 50
    assert out["cache_read_input_tokens"] == 10_000
    # Older SDK objects without cache fields.
    assert eff.anthropic_usage(SimpleNamespace(input_tokens=7, output_tokens=1))["input_tokens"] == 7


@pytest.mark.asyncio
async def test_shared_client_reused_per_loop():
    made = []

    def factory(**kw):
        made.append(kw)
        return object()

    a = eff.shared_client("x", {"api_key": "k"}, factory)
    b = eff.shared_client("x", {"api_key": "k"}, factory)
    c = eff.shared_client("x", {"api_key": "other"}, factory)
    assert a is b and a is not c and len(made) == 2


def test_shared_client_without_loop_builds_fresh():
    made = []
    eff.shared_client("x", {}, lambda **kw: made.append(1) or object())
    eff.shared_client("x", {}, lambda **kw: made.append(1) or object())
    assert len(made) == 2


@pytest.mark.asyncio
async def test_provider_sends_cache_control_and_reports_usage(monkeypatch):
    sent = {}

    class FakeMessages:
        async def create(self, **kwargs):
            sent.update(kwargs)
            return SimpleNamespace(
                stop_reason="end_turn",
                content=[],
                usage=SimpleNamespace(
                    input_tokens=10, output_tokens=2, cache_creation_input_tokens=0, cache_read_input_tokens=100
                ),
            )

    class FakeClient:
        def __init__(self, **kw):
            self.messages = FakeMessages()

    import anthropic

    monkeypatch.setattr(anthropic, "AsyncAnthropic", FakeClient)
    provider = AnthropicLLMProvider(api_key=f"test-{id(asyncio.get_running_loop())}")
    result = await provider.chat(
        [{"role": "system", "content": "sys"}, {"role": "user", "content": "hoi"}],
        tools=[{"name": "t", "input_schema": {}}],
        model="claude-sonnet-4-5",
    )
    assert sent["tools"][-1]["cache_control"] == {"type": "ephemeral"}
    assert sent["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert result["usage"]["input_tokens"] == 20
    assert result["usage"]["cache_read_input_tokens"] == 100
