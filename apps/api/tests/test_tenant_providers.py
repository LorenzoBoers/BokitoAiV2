"""Tests for per-tenant provider connections and model catalog."""

import pytest
from httpx import AsyncClient

from app.models.auth import Tenant
from app.models.agent import Agent
from app.services import provider_connections, tenant_model_catalog
from app.services.model_catalog import seed_model_catalog
from app.services.model_resolution import resolve_model_call


@pytest.mark.asyncio
async def test_create_provider_and_enable_presets(session_override):
    await seed_model_catalog(session_override)
    tenant = Tenant(slug="prov-a", name="Prov A")
    session_override.add(tenant)
    await session_override.commit()
    await session_override.refresh(tenant)

    conn = await provider_connections.create_connection(
        session_override,
        tenant.id,
        provider_type="anthropic",
        api_key="sk-ant-test-key-1234",
    )
    assert conn.provider_type == "anthropic"
    assert conn.last4 == "1234"
    assert conn.encrypted_value
    assert conn.encrypted_value != "sk-ant-test-key-1234"

    created = await tenant_model_catalog.bulk_enable_presets(session_override, tenant.id, conn.id)
    assert len(created) >= 3
    models = await tenant_model_catalog.list_models(session_override, tenant.id, kind="chat")
    assert any(m.slug == "claude-sonnet-4-6" for m in models)


@pytest.mark.asyncio
async def test_resolve_tenant_model_byok(session_override):
    await seed_model_catalog(session_override)
    tenant = Tenant(slug="prov-b", name="Prov B")
    session_override.add(tenant)
    await session_override.commit()
    await session_override.refresh(tenant)

    conn = await provider_connections.create_connection(
        session_override,
        tenant.id,
        provider_type="anthropic",
        api_key="sk-ant-tenant-prov-b",
    )
    await tenant_model_catalog.bulk_enable_presets(session_override, tenant.id, conn.id)

    resolved = await resolve_model_call(session_override, tenant.id, kind="chat")
    assert resolved.key_source == "tenant"
    assert resolved.billable is False
    assert resolved.provider_type == "anthropic"
    assert resolved.api_key == "sk-ant-tenant-prov-b"
    assert resolved.slug == "claude-sonnet-4-6"


@pytest.mark.asyncio
async def test_resolve_openai_compatible_base_url(session_override):
    tenant = Tenant(slug="prov-c", name="Prov C")
    session_override.add(tenant)
    await session_override.commit()
    await session_override.refresh(tenant)

    conn = await provider_connections.create_connection(
        session_override,
        tenant.id,
        provider_type="openai_compatible",
        base_url="https://example.com/v1",
        api_key="sk-compat-key-9999",
        label="Custom endpoint",
    )
    await tenant_model_catalog.create_model(
        session_override,
        tenant.id,
        connection_id=conn.id,
        slug="custom-model",
        model_id="my-model-v1",
        display_name="My Model",
        kind="chat",
        is_default_chat=True,
    )

    resolved = await resolve_model_call(
        session_override, tenant.id, kind="chat", model_slug="custom-model"
    )
    assert resolved.provider_type == "openai_compatible"
    assert resolved.base_url == "https://example.com/v1"
    assert resolved.model_id == "my-model-v1"
    assert resolved.key_source == "tenant"


@pytest.mark.asyncio
async def test_agent_model_validates_tenant_model(session_override):
    await seed_model_catalog(session_override)
    tenant = Tenant(slug="prov-d", name="Prov D")
    session_override.add(tenant)
    await session_override.flush()
    agent = Agent(tenant_id=tenant.id, name="Worker", role="assistant", kind="company")
    session_override.add(agent)
    await session_override.commit()
    await session_override.refresh(tenant)
    await session_override.refresh(agent)

    conn = await provider_connections.create_connection(
        session_override,
        tenant.id,
        provider_type="anthropic",
        api_key="sk-ant-agent-test",
    )
    await tenant_model_catalog.bulk_enable_presets(session_override, tenant.id, conn.id)

    # Disable opus so agent cannot use it
    opus = await tenant_model_catalog.get_model(session_override, tenant.id, "claude-opus-4-8")
    assert opus is not None
    await tenant_model_catalog.update_model(session_override, tenant.id, opus.id, enabled=False)

    from fastapi import HTTPException
    from app.services.workforce_runtime import update_agent_model

    with pytest.raises(HTTPException) as exc_info:
        await update_agent_model(session_override, tenant.id, agent.id, "claude-opus-4-8")
    assert exc_info.value.status_code == 400

    result = await update_agent_model(session_override, tenant.id, agent.id, "claude-haiku-4-5")
    assert result["agent"]["model"] == "claude-haiku-4-5"


@pytest.mark.asyncio
async def test_providers_api(client: AsyncClient):
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    listed = await client.get("/api/settings/providers", headers=headers)
    assert listed.status_code == 200
    assert "presets" in listed.json()
    assert "anthropic" in listed.json()["presets"]

    created = await client.post(
        "/api/settings/providers",
        json={"provider_type": "anthropic", "api_key": "sk-ant-api-test-5678"},
        headers=headers,
    )
    assert created.status_code == 200
    conn_id = created.json()["id"]

    enable = await client.post(
        "/api/settings/models",
        json={"connection_id": conn_id, "enable_presets": True},
        headers=headers,
    )
    assert enable.status_code == 200

    models = await client.get("/api/settings/models", headers=headers)
    assert models.status_code == 200
    payload = models.json()
    assert payload["source"] == "tenant"
    assert any(m["slug"] == "claude-sonnet-4-6" for m in payload["models"])
