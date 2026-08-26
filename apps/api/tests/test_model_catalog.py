import pytest
from httpx import AsyncClient

from app.models.auth import Tenant
from app.models.agent import Agent
from app.services import platform_secrets, tenant_secrets
from app.services.agent.llm import OpenAILLMProvider
from app.services.model_catalog import get_default_model, seed_model_catalog
from app.services.model_resolution import compute_costs, record_usage, resolve_model_call


@pytest.mark.asyncio
async def test_seed_and_default_model(session_override):
    await seed_model_catalog(session_override)
    chat = await get_default_model(session_override, "chat")
    emb = await get_default_model(session_override, "embedding")
    # The Bokito virtual model is the platform default chat model.
    assert chat is not None and chat.slug == "bokito-ai-3-1"
    assert chat.provider == "bokito"
    assert chat.display_name == "Bokito AI 3.1"
    assert emb is not None and emb.kind == "embedding"
    # Re-seeding is idempotent.
    await seed_model_catalog(session_override)
    again = await get_default_model(session_override, "chat")
    assert again.slug == "bokito-ai-3-1"


@pytest.mark.asyncio
async def test_resolve_byok_platform_mock(session_override):
    await seed_model_catalog(session_override)
    tenant = Tenant(slug="resolve-a", name="Resolve A")
    session_override.add(tenant)
    await session_override.commit()
    await session_override.refresh(tenant)

    # No keys anywhere -> mock. Default chat is the Bokito virtual model,
    # routed to its Anthropic backing model.
    resolved = await resolve_model_call(session_override, tenant.id, kind="chat")
    assert resolved.key_source == "mock"
    assert resolved.billable is False
    assert resolved.provider == "bokito"
    assert resolved.provider_type == "anthropic"

    # Platform key only -> platform (billable).
    await platform_secrets.set_platform_secret(session_override, "anthropic", "sk-ant-platform-9999")
    resolved = await resolve_model_call(session_override, tenant.id, kind="chat")
    assert resolved.key_source == "platform"
    assert resolved.billable is True
    assert resolved.api_key == "sk-ant-platform-9999"

    # Tenant BYOK overrides platform and is not billable.
    await tenant_secrets.set_secret(session_override, tenant.id, "anthropic", "sk-ant-tenant-1111")
    resolved = await resolve_model_call(session_override, tenant.id, kind="chat")
    assert resolved.key_source == "tenant"
    assert resolved.billable is False
    assert resolved.api_key == "sk-ant-tenant-1111"
    # Pricing comes from the catalog row.
    assert resolved.input_cost_per_mtok_cents == 300
    assert resolved.output_cost_per_mtok_cents == 1500


@pytest.mark.asyncio
async def test_bokito_virtual_model_routing(session_override):
    """The Bokito model resolves to its backing model but keeps its identity."""
    await seed_model_catalog(session_override)
    tenant = Tenant(slug="bokito-route", name="Bokito Route")
    session_override.add(tenant)
    await session_override.commit()
    await session_override.refresh(tenant)

    await platform_secrets.set_platform_secret(session_override, "anthropic", "sk-ant-platform-7777")
    resolved = await resolve_model_call(
        session_override, tenant.id, kind="chat", model_slug="bokito-ai-3-1"
    )
    # The LLM call goes to the real backing model...
    assert resolved.provider_type == "anthropic"
    assert resolved.model_id == "claude-sonnet-4-6"
    assert resolved.api_key == "sk-ant-platform-7777"
    # ...but slug and usage label keep the Bokito identity.
    assert resolved.slug == "bokito-ai-3-1"
    assert resolved.provider == "bokito"

    entry = await record_usage(
        session_override, tenant.id, resolved, tokens_in=100, tokens_out=50, commit=True
    )
    assert entry.model == "bokito-ai-3-1"
    assert entry.provider == "bokito"


def test_bokito_billing_margin():
    """Customer pays the Bokito list price; provider cost follows the backing model."""
    from app.services.model_resolution import ResolvedModelCall

    resolved = ResolvedModelCall(
        slug="bokito-ai-3-1",
        provider="bokito",
        provider_type="anthropic",
        model_id="claude-haiku-4-5-20251001",
        kind="chat",
        api_key="sk-x",
        key_source="platform",
        # Cheap backing model...
        input_cost_per_mtok_cents=100,
        output_cost_per_mtok_cents=500,
        markup=1.3,
        # ...billed at the Bokito list price.
        bill_input_cost_per_mtok_cents=300,
        bill_output_cost_per_mtok_cents=1500,
    )
    provider_micros, customer_micros = compute_costs(resolved, 1000, 500)
    assert provider_micros == round(1000 * 100 / 100 + 500 * 500 / 100)  # 3500
    assert customer_micros == round((1000 * 300 / 100 + 500 * 1500 / 100) * 1.3)  # 13650


@pytest.mark.asyncio
async def test_bokito_default_promoted_on_existing_catalog(session_override):
    """Databases seeded before the Bokito model move their default to it."""
    from sqlalchemy import select

    from app.models.model_catalog import ModelCatalog

    await seed_model_catalog(session_override)
    # Simulate a pre-Bokito database: sonnet is default, bokito is not.
    rows = (await session_override.execute(select(ModelCatalog))).scalars().all()
    for row in rows:
        if row.slug == "bokito-ai-3-1":
            row.is_default_chat = False
        if row.slug == "claude-sonnet-4-6":
            row.is_default_chat = True
    await session_override.commit()

    await seed_model_catalog(session_override)
    chat = await get_default_model(session_override, "chat")
    assert chat.slug == "bokito-ai-3-1"
    sonnet = (
        await session_override.execute(
            select(ModelCatalog).where(ModelCatalog.slug == "claude-sonnet-4-6")
        )
    ).scalar_one()
    assert sonnet.is_default_chat is False


@pytest.mark.asyncio
async def test_legacy_agent_models_migrate_to_bokito(session_override):
    """Agents on retired snapshot ids move to the Bokito model at startup."""
    tenant = Tenant(slug="legacy-models", name="Legacy Models")
    session_override.add(tenant)
    await session_override.flush()
    legacy = Agent(tenant_id=tenant.id, name="Old", role="assistant", model="claude-sonnet-4-20250514")
    explicit = Agent(tenant_id=tenant.id, name="Pinned", role="assistant", model="claude-sonnet-4-6")
    session_override.add(legacy)
    session_override.add(explicit)
    await session_override.commit()

    await seed_model_catalog(session_override)
    await session_override.refresh(legacy)
    await session_override.refresh(explicit)
    assert legacy.model == "bokito-ai-3-1"
    # A deliberate choice of a current real model is left alone.
    assert explicit.model == "claude-sonnet-4-6"


@pytest.mark.asyncio
async def test_bokito_identity_line_in_system_prompt(session_override):
    """Agents on the Bokito model present as Bokito AI 3.1; others do not."""
    from app.services.agent.loop import AgentLoop
    from app.services.model_resolution import ResolvedModelCall

    await seed_model_catalog(session_override)
    tenant = Tenant(slug="identity-a", name="Identity A")
    session_override.add(tenant)
    await session_override.flush()
    agent = Agent(tenant_id=tenant.id, name="Worker", role="assistant", model="bokito-ai-3-1")
    session_override.add(agent)
    await session_override.commit()
    await session_override.refresh(tenant)
    await session_override.refresh(agent)

    loop = AgentLoop(session_override, tenant.id, None, agent=agent)
    loop.resolved_call = ResolvedModelCall(
        slug="bokito-ai-3-1", provider="bokito", provider_type="anthropic",
        model_id="claude-sonnet-4-6", kind="chat", api_key="", key_source="mock",
    )
    prompt = await loop._build_system_prompt()
    assert "Bokito AI 3.1" in prompt
    assert "Never state or imply" in prompt

    # A real (BYOK or platform) model keeps its actual identity.
    loop.resolved_call = ResolvedModelCall(
        slug="claude-sonnet-4-6", provider="anthropic", provider_type="anthropic",
        model_id="claude-sonnet-4-6", kind="chat", api_key="", key_source="mock",
    )
    prompt = await loop._build_system_prompt()
    assert "Model identity" not in prompt


@pytest.mark.asyncio
async def test_resolve_raw_agent_model_id(session_override):
    await seed_model_catalog(session_override)
    tenant = Tenant(slug="raw-model", name="Raw Model")
    session_override.add(tenant)
    await session_override.commit()
    await session_override.refresh(tenant)

    await platform_secrets.set_platform_secret(session_override, "anthropic", "sk-ant-platform-9999")
    resolved = await resolve_model_call(
        session_override,
        tenant.id,
        kind="chat",
        model_slug="claude-haiku-4-5-20251001",
    )
    assert resolved.model_id == "claude-haiku-4-5-20251001"
    assert resolved.key_source == "platform"
    assert resolved.live is True


@pytest.mark.asyncio
async def test_compute_costs_and_record(session_override):
    await seed_model_catalog(session_override)
    tenant = Tenant(slug="cost-a", name="Cost A")
    session_override.add(tenant)
    await session_override.commit()
    await session_override.refresh(tenant)

    await platform_secrets.set_platform_secret(session_override, "anthropic", "sk-ant-platform-5555")
    resolved = await resolve_model_call(session_override, tenant.id, kind="chat")
    resolved.markup = 1.3  # deterministic for the assertion

    provider_micros, customer_micros = compute_costs(resolved, 1000, 500)
    # 1000*300/100 + 500*1500/100 = 3000 + 7500 = 10500 micro-USD
    assert provider_micros == 10500
    assert customer_micros == round(10500 * 1.3)

    entry = await record_usage(
        session_override, tenant.id, resolved, tokens_in=1000, tokens_out=500,
        scope="chat", call_type="chat", commit=True,
    )
    assert entry.billable is True
    assert entry.provider_cost_micros == 10500
    assert entry.customer_cost_micros == round(10500 * 1.3)


@pytest.mark.asyncio
async def test_byok_usage_not_billable(session_override):
    await seed_model_catalog(session_override)
    tenant = Tenant(slug="byok-a", name="BYOK A")
    session_override.add(tenant)
    await session_override.commit()
    await session_override.refresh(tenant)

    await tenant_secrets.set_secret(session_override, tenant.id, "anthropic", "sk-ant-tenant-2222")
    resolved = await resolve_model_call(session_override, tenant.id, kind="chat")
    entry = await record_usage(
        session_override, tenant.id, resolved, tokens_in=1000, tokens_out=500, commit=True
    )
    assert entry.key_source == "tenant"
    assert entry.billable is False
    assert entry.customer_cost_micros == 0
    assert entry.provider_cost_micros > 0


def test_openai_translation():
    tools = [{"name": "search", "description": "d", "input_schema": {"type": "object"}}]
    oai_tools = OpenAILLMProvider._tools_to_openai(tools)
    assert oai_tools[0]["type"] == "function"
    assert oai_tools[0]["function"]["name"] == "search"
    assert oai_tools[0]["function"]["parameters"] == {"type": "object"}

    messages = [
        {"role": "system", "content": "sys"},
        {"role": "user", "content": "hi"},
        {
            "role": "assistant",
            "content": [
                {"type": "text", "text": "thinking"},
                {"type": "tool_use", "id": "t1", "name": "search", "input": {"q": "x"}},
            ],
        },
        {
            "role": "user",
            "content": [{"type": "tool_result", "tool_use_id": "t1", "content": "result"}],
        },
    ]
    oai = OpenAILLMProvider._messages_to_openai(messages)
    assert oai[0] == {"role": "system", "content": "sys"}
    assert oai[1] == {"role": "user", "content": "hi"}
    assistant = oai[2]
    assert assistant["role"] == "assistant"
    assert assistant["tool_calls"][0]["function"]["name"] == "search"
    tool_msg = oai[3]
    assert tool_msg["role"] == "tool"
    assert tool_msg["tool_call_id"] == "t1"


@pytest.mark.asyncio
async def test_tenant_models_api_and_agent_patch(client: AsyncClient):
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    # The catalog isn't seeded by the mocked init_db, so seed via the app session.
    from app.db.session import get_session
    from app.main import app

    gen = app.dependency_overrides[get_session]()
    session = await gen.__anext__()
    await seed_model_catalog(session)

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    res = await client.get("/api/settings/models", headers=headers)
    assert res.status_code == 200
    payload = res.json()
    assert payload.get("source") == "platform"
    assert any(m["slug"] == "claude-sonnet-4-6" for m in payload["models"])
    # No BYOK -> both providers billable.
    assert set(payload["billable_providers"]) == {"anthropic", "openai"}

    # Restrict allowed chat models to just haiku.
    put = await client.put(
        "/api/settings/models",
        json={"allowed_chat": ["claude-haiku-4-5"], "default_chat": "claude-haiku-4-5"},
        headers=headers,
    )
    assert put.status_code == 200
    assert put.json()["prefs"]["allowed_chat"] == ["claude-haiku-4-5"]

    # Find a company agent to repoint.
    agents = (await client.get("/api/workforce/agents", headers=headers)).json()["items"]
    agent_id = agents[0]["id"]

    # A blocked model is rejected.
    blocked = await client.patch(
        f"/api/workforce/agents/{agent_id}/model", json={"model": "claude-opus-4-8"}, headers=headers
    )
    assert blocked.status_code == 403

    # An allowed model succeeds and updates provider.
    ok = await client.patch(
        f"/api/workforce/agents/{agent_id}/model", json={"model": "claude-haiku-4-5"}, headers=headers
    )
    assert ok.status_code == 200
    assert ok.json()["agent"]["model"] == "claude-haiku-4-5"


@pytest.mark.asyncio
async def test_staff_required_for_catalog(client: AsyncClient):
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    # The seeded test user is not staff.
    res = await client.get("/api/staff/models", headers=headers)
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_project_usage_aggregation(session_override):
    from datetime import datetime, timedelta

    from app.models.agent import AgentRun
    from app.models.project import Project
    from app.services.projects import _token_usage
    from app.services.model_resolution import resolve_model_call, record_usage

    await seed_model_catalog(session_override)
    tenant = Tenant(slug="proj-a", name="Proj A")
    session_override.add(tenant)
    await session_override.commit()
    await session_override.refresh(tenant)

    project = Project(tenant_id=tenant.id, name="P1", slug="p1")
    session_override.add(project)
    await session_override.flush()
    agent = Agent(tenant_id=tenant.id, name="A1", role="assistant")
    session_override.add(agent)
    await session_override.flush()
    run = AgentRun(tenant_id=tenant.id, agent_id=agent.id, project_id=project.id)
    session_override.add(run)
    await session_override.flush()

    resolved = await resolve_model_call(session_override, tenant.id, kind="chat")
    await record_usage(
        session_override, tenant.id, resolved, tokens_in=100, tokens_out=50,
        scope="orchestration", scope_id=str(run.id), run_id=run.id, agent_id=agent.id, commit=True,
    )

    since = datetime.utcnow() - timedelta(days=1)
    total = await _token_usage(session_override, tenant.id, project.id, since)
    assert total == 150
