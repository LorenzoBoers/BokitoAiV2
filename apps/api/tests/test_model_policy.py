"""Unit tests for chat model selection policy."""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.models.auth import Tenant
from app.services import model_policy, tenant_models
from app.services.model_catalog import seed_model_catalog
from app.services.model_policy import ModelSelectionContext, resolve_chat_model_slug


@pytest.mark.asyncio
async def test_pick_automatic_slug_hints():
    assert model_policy.pick_automatic_slug("triage") == "bokito-maki"
    assert model_policy.pick_automatic_slug("complex research") == "bokito-kong"
    assert model_policy.pick_automatic_slug(None) == "bokito-ai-3-1"
    assert model_policy.pick_automatic_slug("") == "bokito-ai-3-1"


def test_unset_workspace_prefs_default_to_automatic():
    assert model_policy.workspace_chat_mode({}) == "automatic"
    assert model_policy.workspace_chat_mode({"workspace_chat_mode": ""}) == "automatic"
    assert (
        model_policy.workspace_chat_mode({"default_chat": "bokito-maki"}) == "bokito-maki"
    )


def test_default_tenant_settings_use_automatic():
    from app.services.tenant_bootstrap import default_tenant_settings

    settings = default_tenant_settings()
    assert settings["models"]["workspace_chat_mode"] == "automatic"


@pytest.mark.asyncio
async def test_resolve_override_beats_agent_and_workspace(session_override):
    await seed_model_catalog(session_override)
    tenant = Tenant(slug="policy-ov", name="Policy OV")
    session_override.add(tenant)
    await session_override.commit()
    await session_override.refresh(tenant)

    await tenant_models.set_tenant_model_prefs(
        session_override, tenant.id, workspace_chat_mode="bokito-maki"
    )

    selected = await resolve_chat_model_slug(
        session_override,
        tenant.id,
        ModelSelectionContext(
            override_slug="bokito-kong",
            agent_model="bokito-maki",
            task_hint="light",
        ),
    )
    assert selected.slug == "bokito-kong"
    assert selected.source == "override"
    assert selected.automatic is False


@pytest.mark.asyncio
async def test_resolve_agent_automatic_and_inherit(session_override):
    await seed_model_catalog(session_override)
    tenant = Tenant(slug="policy-ag", name="Policy AG")
    session_override.add(tenant)
    await session_override.commit()
    await session_override.refresh(tenant)

    await tenant_models.set_tenant_model_prefs(
        session_override, tenant.id, workspace_chat_mode="bokito-kong"
    )

    auto = await resolve_chat_model_slug(
        session_override,
        tenant.id,
        ModelSelectionContext(agent_model="automatic", task_hint="classify"),
    )
    assert auto.slug == "bokito-maki"
    assert auto.source == "automatic"
    assert auto.automatic is True

    inherit = await resolve_chat_model_slug(
        session_override,
        tenant.id,
        ModelSelectionContext(agent_model="inherit"),
    )
    assert inherit.slug == "bokito-kong"
    assert inherit.source == "workspace"

    empty = await resolve_chat_model_slug(
        session_override,
        tenant.id,
        ModelSelectionContext(agent_model=""),
    )
    assert empty.slug == "bokito-kong"
    assert empty.source == "workspace"


@pytest.mark.asyncio
async def test_resolve_workspace_automatic(session_override):
    await seed_model_catalog(session_override)
    tenant = Tenant(slug="policy-ws", name="Policy WS")
    session_override.add(tenant)
    await session_override.commit()
    await session_override.refresh(tenant)

    await tenant_models.set_tenant_model_prefs(
        session_override, tenant.id, workspace_chat_mode="automatic"
    )

    selected = await resolve_chat_model_slug(
        session_override,
        tenant.id,
        ModelSelectionContext(agent_model="inherit", task_hint="deep analysis"),
    )
    assert selected.slug == "bokito-kong"
    assert selected.source == "automatic"
    assert selected.automatic is True


@pytest.mark.asyncio
async def test_patch_workspace_chat_mode_api(client: AsyncClient):
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    from app.db.session import get_session
    from app.main import app

    gen = app.dependency_overrides[get_session]()
    session = await gen.__anext__()
    await seed_model_catalog(session)

    login = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    r = await client.patch(
        "/api/settings/models/workspace-chat-mode",
        headers=headers,
        json={"workspace_chat_mode": "automatic"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("workspace_chat_mode") == "automatic"
    assert body.get("managed", {}).get("workspace_chat_mode") == "automatic"

    r2 = await client.patch(
        "/api/settings/models/workspace-chat-mode",
        headers=headers,
        json={"workspace_chat_mode": "bokito-maki"},
    )
    assert r2.status_code == 200, r2.text
    assert r2.json().get("workspace_chat_mode") == "bokito-maki"
    managed = {m["slug"]: m for m in r2.json().get("managed", {}).get("models", [])}
    assert managed["bokito-maki"].get("is_workspace_default") is True
    assert managed["bokito-ai-3-1"].get("is_workspace_default") is False
