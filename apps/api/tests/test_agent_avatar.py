"""Agent visual identity helpers."""

from __future__ import annotations

from uuid import uuid4

from app.models.agent import Agent
from app.services.agent_avatar import PLATFORM_AVATAR_COLOR, apply_avatar_settings, avatar_payload


def _agent(**settings) -> Agent:
    import json

    return Agent(
        id=uuid4(),
        tenant_id=uuid4(),
        name="Support",
        kind="company",
        slug="front-desk",
        settings_json=json.dumps(settings),
    )


def test_avatar_payload_defaults_to_orb():
    """Unmarked agents get the round purple bot; initials stay opt-in."""
    from app.services.agent_avatar import DEFAULT_AVATAR_SHAPE, DEFAULT_ORB_COLOR

    empty = avatar_payload(None)
    assert empty["avatar_kind"] == "orb"
    assert empty["avatar_color"] == DEFAULT_ORB_COLOR
    assert empty["avatar_shape"] == DEFAULT_AVATAR_SHAPE
    payload = avatar_payload(_agent())
    assert payload["avatar_kind"] == "orb"
    assert payload["avatar_icon"] is None
    assert payload["avatar_color"] == DEFAULT_ORB_COLOR
    assert payload["avatar_shape"] == DEFAULT_AVATAR_SHAPE


def test_avatar_payload_icon_mode_uses_role_default_when_missing():
    agent = _agent(avatar_kind="icon")
    payload = avatar_payload(agent)
    assert payload["avatar_kind"] == "icon"
    assert payload["avatar_icon"] == "headset"
    assert payload["avatar_color"] == PLATFORM_AVATAR_COLOR


def test_avatar_payload_icon_always_platform_color():
    agent = _agent(avatar_kind="icon", avatar_icon="headset", avatar_color="#4652F2")
    payload = avatar_payload(agent)
    assert payload == {
        "avatar_kind": "icon",
        "avatar_icon": "headset",
        "avatar_color": PLATFORM_AVATAR_COLOR,
        "avatar_shape": None,
        "avatar_image_url": None,
    }


def test_avatar_payload_orb_keeps_curated_color():
    agent = _agent(avatar_kind="orb", avatar_color="#00c972", avatar_shape="bokito")
    payload = avatar_payload(agent)
    assert payload == {
        "avatar_kind": "orb",
        "avatar_icon": None,
        "avatar_color": "#00c972",
        "avatar_shape": "bokito",
        "avatar_image_url": None,
    }


def test_avatar_payload_retired_shape_falls_back_to_bokito():
    agent = _agent(avatar_kind="orb", avatar_color="#00c972", avatar_shape="star")
    payload = avatar_payload(agent)
    assert payload["avatar_shape"] == "bokito"


def test_avatar_payload_retired_monkey_maps_to_bokito():
    agent = _agent(avatar_kind="orb", avatar_color="#00c972", avatar_shape="monkey")
    payload = avatar_payload(agent)
    assert payload["avatar_shape"] == "bokito"
    chimp = _agent(avatar_kind="orb", avatar_color="#00c972", avatar_shape="chimp")
    assert avatar_payload(chimp)["avatar_shape"] == "bokito"


def test_avatar_payload_image_requires_upload_path():
    tenant = uuid4()
    url = f"/api/uploads/files/{tenant}/photo.png"
    agent = _agent(avatar_kind="image", avatar_image_url=url, avatar_color="#059669")
    payload = avatar_payload(agent)
    assert payload["avatar_kind"] == "image"
    assert payload["avatar_image_url"] == url
    assert payload["avatar_color"] == PLATFORM_AVATAR_COLOR


def test_apply_avatar_rejects_bad_icon():
    try:
        apply_avatar_settings({}, avatar_kind="icon", avatar_icon="not-a-real-icon")
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "avatar_icon" in str(exc)


def test_apply_avatar_pins_platform_color():
    out = apply_avatar_settings(
        {},
        avatar_kind="icon",
        avatar_icon="bot",
        avatar_color="#059669",
    )
    assert out["avatar_color"] == PLATFORM_AVATAR_COLOR
    assert out["avatar_icon"] == "bot"


def test_apply_avatar_orb_stores_color_and_shape():
    out = apply_avatar_settings(
        {},
        avatar_kind="orb",
        avatar_color="#00c972",
        avatar_shape="hex",
    )
    assert out["avatar_kind"] == "orb"
    assert out["avatar_color"] == "#00c972"
    assert out["avatar_shape"] == "hex"
    assert "avatar_icon" not in out


def test_apply_avatar_orb_accepts_brand_hex_and_triangles():
    out = apply_avatar_settings(
        {},
        avatar_kind="orb",
        avatar_color="#32BF8E",
        avatar_shape="triangle",
    )
    assert out["avatar_color"] == "#32bf8e"
    assert out["avatar_shape"] == "triangle"
    down = apply_avatar_settings(
        {},
        avatar_kind="orb",
        avatar_color="#32bf8e",
        avatar_shape="triangledown",
    )
    assert down["avatar_shape"] == "triangledown"


def test_coding_agent_shapes_follow_feature_flag(monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "feature_coding_agent_integrations", False)
    hidden = avatar_payload(
        _agent(avatar_kind="orb", avatar_color="#d97757", avatar_shape="claude")
    )
    assert hidden["avatar_shape"] == "bokito"
    try:
        apply_avatar_settings({}, avatar_kind="orb", avatar_shape="cursor")
    except ValueError as exc:
        assert "avatar_shape" in str(exc)
    else:
        raise AssertionError("cursor shape should be rejected while the flag is off")

    monkeypatch.setattr(get_settings(), "feature_coding_agent_integrations", True)
    shown = avatar_payload(
        _agent(avatar_kind="orb", avatar_color="#d97757", avatar_shape="claude")
    )
    assert shown["avatar_shape"] == "claude"
    saved = apply_avatar_settings({}, avatar_kind="orb", avatar_shape="cursor")
    assert saved["avatar_shape"] == "cursor"


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
            "avatar_color": PLATFORM_AVATAR_COLOR,
            "avatar_image_url": image,
        },
    )
    assert theme["widget_favicon_url"] == f"https://app.example{image}"
    assert theme["agent_avatar_image_url"] == f"https://app.example{image}"
    assert theme["agent_avatar_color"] == PLATFORM_AVATAR_COLOR
