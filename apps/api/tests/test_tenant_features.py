"""Unit tests for custom-models feature gates."""

from __future__ import annotations

from types import SimpleNamespace

from app.services import tenant_features


def _tenant(*, entitled: bool = False, opted_in: bool = False) -> SimpleNamespace:
    features = {}
    if entitled:
        features["custom_models"] = True
    if opted_in:
        features["custom_models_enabled"] = True
    import json

    return SimpleNamespace(settings_json=json.dumps({"features": features}) if features else "{}")


def test_custom_models_blocked_when_env_off(monkeypatch):
    monkeypatch.setattr(
        "app.services.tenant_features.get_settings",
        lambda: SimpleNamespace(feature_custom_models=False),
    )
    tenant = _tenant(entitled=True, opted_in=True)
    assert tenant_features.custom_models_allowed(tenant) is False
    assert tenant_features.custom_models_active(tenant) is False


def test_custom_models_needs_entitlement_and_opt_in(monkeypatch):
    monkeypatch.setattr(
        "app.services.tenant_features.get_settings",
        lambda: SimpleNamespace(feature_custom_models=True),
    )
    entitled_only = _tenant(entitled=True, opted_in=False)
    assert tenant_features.custom_models_allowed(entitled_only) is True
    assert tenant_features.custom_models_active(entitled_only) is False

    both = _tenant(entitled=True, opted_in=True)
    assert tenant_features.custom_models_active(both) is True

    neither = _tenant()
    assert tenant_features.custom_models_allowed(neither) is False
