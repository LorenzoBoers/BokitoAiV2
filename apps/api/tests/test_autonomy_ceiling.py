"""The inbox ceiling is its own setting. Messaging allowances do not move it."""

from types import SimpleNamespace

from app.services.ai_handling import governance_ceiling, resolve_ai_handling


def _tenant(settings: str) -> SimpleNamespace:
    return SimpleNamespace(settings_json=settings, name="Acme")


def test_explicit_ceiling_ignores_messaging_allow(monkeypatch):
    monkeypatch.setattr(
        "app.services.privacy.tenant_allows_llm_message_bodies",
        lambda _tenant: True,
    )
    tenant = _tenant('{"ai_handling":{"ceiling":"assisted"},"tool_allowances":{"messaging":"allow"}}')
    ceiling, clamped = governance_ceiling(tenant)  # type: ignore[arg-type]
    assert ceiling == "assisted"
    assert clamped == "govern"


def test_flow_dial_sets_mode_under_the_ceiling(monkeypatch):
    monkeypatch.setattr(
        "app.services.privacy.tenant_allows_llm_message_bodies",
        lambda _tenant: True,
    )
    tenant = SimpleNamespace(
        settings_json='{"ai_handling":{"default":"autonomous","ceiling":"assisted"}}',
        name="Acme",
    )
    stricter = resolve_ai_handling(tenant, scope="flow", flow_mode="manual")  # type: ignore[arg-type]
    assert stricter.effective == "manual" and stricter.source == "flow"
    looser = resolve_ai_handling(tenant, scope="flow", flow_mode="autonomous")  # type: ignore[arg-type]
    assert looser.effective == "assisted" and looser.clamped_by == "govern"
