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


def test_compose_default_has_avatar_and_identity():
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
    assert "border-radius:50%" in html
    assert "data:image/svg+xml" in html
    assert "border-left:2px solid" in html


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
    assert "border-radius:50%" in resolved
    identity = (user.display_name or user.email).strip()
    assert identity in resolved
