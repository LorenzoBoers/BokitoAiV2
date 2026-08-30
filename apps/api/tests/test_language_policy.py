"""Language policy helpers for internal vs external agent chats."""

from app.services.language import (
    internal_language_instruction,
    language_rules_for_trust,
    reply_language_instruction,
)


def test_internal_language_uses_workspace_dutch():
    text = internal_language_instruction("nl")
    assert "Dutch" in text
    assert "internal" in text.lower() or "Bokito" in text


def test_language_rules_for_operator_vs_external():
    class FakeTenant:
        settings_json = '{"ai_workspace_language": "nl", "ai_reply_language": "auto"}'

    tenant = FakeTenant()
    internal = language_rules_for_trust("operator", tenant)  # type: ignore[arg-type]
    assert "Dutch" in internal
    assert "Language" in internal

    external = language_rules_for_trust("external", tenant)  # type: ignore[arg-type]
    assert "customer's message" in external or "same language" in external
    assert reply_language_instruction("auto") in external or "mirror" in external.lower()
