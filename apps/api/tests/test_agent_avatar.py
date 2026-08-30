"""Agent visual identity helpers."""

from __future__ import annotations

from uuid import uuid4

from app.models.agent import Agent
from app.services.agent_avatar import apply_avatar_settings, avatar_payload


def _agent(**settings) -> Agent:
    import json

    return Agent(
        id=uuid4(),
        tenant_id=uuid4(),
        name="Support",
        kind="company",
        settings_json=json.dumps(settings),
    )


def test_avatar_payload_defaults_to_initials():
    assert avatar_payload(None)["avatar_kind"] == "initials"
    assert avatar_payload(_agent())["avatar_kind"] == "initials"


def test_avatar_payload_icon_and_color():
    agent = _agent(avatar_kind="icon", avatar_icon="headset", avatar_color="#4652F2")
    payload = avatar_payload(agent)
    assert payload == {
        "avatar_kind": "icon",
        "avatar_icon": "headset",
        "avatar_color": "#4652f2",
        "avatar_image_url": None,
    }


def test_avatar_payload_image_requires_upload_path():
    tenant = uuid4()
    url = f"/api/uploads/files/{tenant}/photo.png"
    agent = _agent(avatar_kind="image", avatar_image_url=url, avatar_color="#059669")
    payload = avatar_payload(agent)
    assert payload["avatar_kind"] == "image"
    assert payload["avatar_image_url"] == url


def test_apply_avatar_rejects_bad_icon():
    try:
        apply_avatar_settings({}, avatar_kind="icon", avatar_icon="not-a-real-icon")
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "avatar_icon" in str(exc)


def test_theme_prefers_agent_image(monkeypatch):
    from app.models.auth import Tenant
    from app.services import livechat_compat
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "public_api_url", "https://app.example")

    tenant_id = uuid4()
    tenant = Tenant(id=tenant_id, name="Acme", slug="acme", settings_json="{}")
    image = f"/api/uploads/files/{tenant_id}/face.png"
    theme = livechat_compat.livechat_theme_from_tenant(
        tenant,
        assistant_name="Bo",
        agent_avatar={
            "avatar_kind": "image",
            "avatar_icon": None,
            "avatar_color": "#4652f2",
            "avatar_image_url": image,
        },
    )
    assert theme["widget_favicon_url"] == f"https://app.example{image}"
    assert theme["agent_avatar_image_url"] == f"https://app.example{image}"
    assert theme["agent_avatar_color"] == "#4652f2"
