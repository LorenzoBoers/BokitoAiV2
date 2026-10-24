"""Voice quality tier resolution (Ops current/top + per-agent override)."""

from app.services.voice_models import (
    DEFAULT_TIER,
    models_for_tier,
    normalize_tier,
    resolve_tier,
)


def test_normalize_tier_aliases():
    assert normalize_tier("current") == "current"
    assert normalize_tier("TOP") == "top"
    assert normalize_tier("premium") == "top"
    assert normalize_tier("inherit") is None
    assert normalize_tier("") is None


def test_resolve_tier_agent_overrides_platform():
    assert (
        resolve_tier(
            agent_settings='{"call_voice_model": "top"}',
            platform_tier="current",
        )
        == "top"
    )
    assert (
        resolve_tier(
            agent_settings='{"call_voice": "marin"}',
            platform_tier="top",
        )
        == "top"
    )
    assert resolve_tier(agent_settings="{}", platform_tier=None) == DEFAULT_TIER


def test_models_for_tier_maps():
    current = models_for_tier("current")
    top = models_for_tier("top")
    assert current["tts_model"] == "gpt-4o-mini-tts"
    assert top["tts_model"] == "gpt-4o-mini-tts-2025-12-15"
    assert top["realtime_model"] == "gpt-realtime-2.1"
    assert current["realtime_model"]
