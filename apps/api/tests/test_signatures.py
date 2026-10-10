"""Signature template rendering + modern default layout."""

from __future__ import annotations

import json

import pytest
from sqlalchemy import select

from app.models.auth import User
from app.services.signatures import (
    compose_default_signature_html,
    render_signature_template,
    resolve_signature_html,
    signature_identity_vars,
)


def test_render_substitutes_placeholders_and_escapes():
    html = "<p><strong>{{name}}</strong><br>{{company}}<br>T: {{phone}}<br>E: {{email}}</p>"
    vars_ = signature_identity_vars(
        name='Ada <script>',
        email="ada@example.com",
        company="Acme",
        phone="",
        language="en",
    )
    out = render_signature_template(html, vars_)
    assert "Ada &lt;script&gt;" in out
    assert "Acme" in out
    assert "ada@example.com" in out
    assert "{{" not in out
    # Empty phone drops the bare "T:" label line.
    assert "T:" not in out


def test_render_aliases_function_to_job_title():
    out = render_signature_template(
        "<p>{{function}}</p>",
        signature_identity_vars(name="Ada", job_title="Engineer"),
    )
    assert "Engineer" in out


def test_first_and_last_name_placeholders():
    vars_ = signature_identity_vars(
        name="Ada Lovelace",
        first_name="Ada",
        last_name="Lovelace",
        language="en",
    )
    assert vars_["first_name"] == "Ada"
    assert vars_["last_name"] == "Lovelace"
    out = render_signature_template(
        "<p>{{first_name}} / {{voornaam}} / {{last_name}}</p>",
        vars_,
    )
    assert out.count("Ada") == 2
    assert "Lovelace" in out


def test_compose_default_is_text_only():
    html = compose_default_signature_html(
        name="Lorenzo",
        email="lorenzo@bokito.ai",
        job_title="Founder",
        company="Bokito",
        language="nl",
    )
    assert "Met vriendelijke groet" in html
    assert "Lorenzo" in html
    assert "Founder" in html
    assert "Bokito" in html
    assert "lorenzo@bokito.ai" in html
    assert "border-left:2px solid" in html
    assert "<img" not in html
    assert "data:image" not in html


def test_avatar_placeholder_uses_https_photo_or_initials():
    from app.services.signatures import avatar_placeholder_html, render_signature_template

    missing = avatar_placeholder_html(avatar_url=None, name="Ada")
    assert "<img" not in missing
    assert "AD" in missing
    svg = avatar_placeholder_html(avatar_url="data:image/svg+xml;base64,abc", name="Ada")
    assert "<img" not in svg
    assert "AD" in svg
    img = avatar_placeholder_html(avatar_url="https://cdn.example.com/a.jpg", name="Ada")
    assert "<img" in img
    assert "https://cdn.example.com/a.jpg" in img
    rendered = render_signature_template(
        "<p>{{avatar}}</p><p>{{name}}</p>",
        {"name": "Ada", "email": "", "job_title": "", "company": "", "phone": "", "website": "", "address": "", "closing": "Hi"},
        avatar_url="https://cdn.example.com/a.jpg",
    )
    assert "<img" in rendered
    assert "Ada" in rendered


def test_email_avatar_src_publishes_profile_photo():
    from uuid import uuid4

    from app.services.signatures import email_avatar_src

    uid = uuid4()
    tiny = (
        "data:image/png;base64,"
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    )
    src = email_avatar_src(tiny, user_id=uid)
    assert src is not None
    assert src.startswith("http")
    assert f"/api/auth/avatars/{uid}" in src
    assert "data:image" not in src
    assert email_avatar_src("data:image/svg+xml;base64,abc", user_id=uid) is None
    assert email_avatar_src(tiny, user_id=None) is None


@pytest.mark.asyncio
async def test_resolve_renders_user_template_placeholders(client, session_override):
    from tests.test_reply_identity import _auth_headers, _seeded

    await _auth_headers(client)
    tenant, agent, _account = await _seeded(session_override)
    user = (
        (await session_override.execute(select(User).where(User.email == "test@bokito.dev")))
        .scalars()
        .first()
    )
    if user is None:
        from scripts.seed import TEST_EMAIL

        user = (
            (await session_override.execute(select(User).where(User.email == TEST_EMAIL)))
            .scalars()
            .first()
        )
    assert user is not None
    user.display_name = "Test User"
    user.job_title = "Operator"
    settings = json.loads(user.settings_json or "{}")
    settings["email_signature_html"] = (
        "<p>{{closing}},<br><strong>{{name}}</strong><br>{{company}}<br>"
        "T: {{phone}}<br>E: {{email}}</p>"
    )
    user.settings_json = json.dumps(settings)
    session_override.add(user)
    await session_override.flush()

    resolved = await resolve_signature_html(
        session_override, tenant.id, send_as="user", user_id=user.id, agent_id=agent.id
    )
    assert resolved is not None
    assert "Test User" in resolved
    assert tenant.name in resolved or "company" not in resolved.lower()
    assert "{{name}}" not in resolved
    assert "{{phone}}" not in resolved
    assert "T:" not in resolved  # empty phone cleaned
    assert user.email in resolved


@pytest.mark.asyncio
async def test_resolve_default_uses_modern_layout(client, session_override):
    from tests.test_reply_identity import _auth_headers, _seeded

    await _auth_headers(client)
    tenant, agent, _account = await _seeded(session_override)
    user = (
        (await session_override.execute(select(User).where(User.email == "test@bokito.dev")))
        .scalars()
        .first()
    )
    if user is None:
        from scripts.seed import TEST_EMAIL

        user = (
            (await session_override.execute(select(User).where(User.email == TEST_EMAIL)))
            .scalars()
            .first()
        )
    assert user is not None
    settings = json.loads(user.settings_json or "{}")
    settings.pop("email_signature_html", None)
    user.settings_json = json.dumps(settings)
    session_override.add(user)
    await session_override.flush()

    resolved = await resolve_signature_html(
        session_override, tenant.id, send_as="user", user_id=user.id, agent_id=agent.id
    )
    assert resolved is not None
    assert "<img" not in resolved
    assert "border-left:2px solid" in resolved
    identity = (user.display_name or user.email).strip()
    assert identity in resolved
