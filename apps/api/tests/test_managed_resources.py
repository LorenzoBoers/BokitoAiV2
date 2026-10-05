"""Managed agent reconcile: create/patch active; archive proposes restore."""

from __future__ import annotations

import json

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant, User
from app.models.platform_change import PlatformChange
from app.services.managed_resources import (
    ensure_managed_agent,
    is_managed,
    management_payload,
)
from app.services.platform_changes import accept_platform_change
from app.services.workforce_runtime import archive_agent, serialize_agent


def _fields(**overrides):
    base = {
        "name": "Strategy Optimizer",
        "slug": "strategy-optimizer",
        "role": "orchestrator",
        "model": "claude-sonnet-4-6",
        "system_prompt": "Optimize.",
        "tools": ["list_docs"],
        "chat_access": "everyone",
        "autonomy_level": "approval",
    }
    base.update(overrides)
    return base


@pytest.mark.asyncio
async def test_ensure_creates_and_patches_active(client: AsyncClient, session_override):
    _ = client
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    created = await ensure_managed_agent(
        session_override,
        tenant,
        managed_origin="stack",
        managed_ref="trading",
        template_slug="strategy-optimizer",
        display_label="Trading",
        create_fields=_fields(),
    )
    assert created.action == "created"
    assert is_managed(created.agent)
    assert created.agent.managed_origin == "stack"
    assert created.agent.template_slug == "strategy-optimizer"
    assert created.agent.kind == "company"
    payload = management_payload(created.agent)
    assert payload["managed"] is True
    assert payload["origin_label"] == "Trading"

    patched = await ensure_managed_agent(
        session_override,
        tenant,
        managed_origin="stack",
        managed_ref="trading",
        template_slug="strategy-optimizer",
        display_label="Trading",
        create_fields=_fields(system_prompt="Updated prompt"),
        patch_fields=_fields(system_prompt="Updated prompt"),
    )
    assert patched.action == "patched"
    assert patched.agent.id == created.agent.id
    assert patched.agent.system_prompt == "Updated prompt"
    assert patched.agent.kind == "company"


@pytest.mark.asyncio
async def test_ensure_archived_proposes_restore_not_reactivate(client: AsyncClient, session_override):
    _ = client
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    created = await ensure_managed_agent(
        session_override,
        tenant,
        managed_origin="stack",
        managed_ref="trading",
        template_slug="mmxm-trader",
        display_label="Trading",
        create_fields=_fields(name="MMXM Trader", slug="mmxm-trader", role="assistant"),
    )
    await session_override.commit()

    await archive_agent(session_override, tenant.id, created.agent.id)
    agent = await session_override.get(Agent, created.agent.id)
    assert agent is not None
    assert agent.kind == "archived"
    assert is_managed(agent)

    result = await ensure_managed_agent(
        session_override,
        tenant,
        managed_origin="stack",
        managed_ref="trading",
        template_slug="mmxm-trader",
        display_label="Trading",
        create_fields=_fields(name="MMXM Trader", slug="mmxm-trader", role="assistant"),
    )
    assert result.action == "restore_proposed"
    assert result.change is not None
    assert result.change.status == "pending_review"
    after = json.loads(result.change.after_json)
    assert after.get("restore") is True

    agent = await session_override.get(Agent, created.agent.id)
    assert agent is not None
    assert agent.kind == "archived"
    assert agent.is_active is False

    # Second ensure dedupes to pending (no second Decision storm).
    again = await ensure_managed_agent(
        session_override,
        tenant,
        managed_origin="stack",
        managed_ref="trading",
        template_slug="mmxm-trader",
        display_label="Trading",
        create_fields=_fields(name="MMXM Trader", slug="mmxm-trader", role="assistant"),
    )
    assert again.action == "restore_pending"
    assert again.change is not None
    assert again.change.id == result.change.id


@pytest.mark.asyncio
async def test_accept_restore_unarchives_managed_agent(client: AsyncClient, session_override):
    _ = client
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    user = (await session_override.execute(select(User).limit(1))).scalar_one()
    created = await ensure_managed_agent(
        session_override,
        tenant,
        managed_origin="stack",
        managed_ref="trading",
        template_slug="strategy-optimizer",
        display_label="Trading",
        create_fields=_fields(
            name="Strategy Optimizer Restore", slug="strategy-optimizer-restore"
        ),
    )
    await session_override.commit()
    await archive_agent(session_override, tenant.id, created.agent.id)

    proposed = await ensure_managed_agent(
        session_override,
        tenant,
        managed_origin="stack",
        managed_ref="trading",
        template_slug="strategy-optimizer",
        display_label="Trading",
        create_fields=_fields(
            name="Strategy Optimizer Restore", slug="strategy-optimizer-restore"
        ),
        match_slugs=["strategy-optimizer-restore"],
    )
    assert proposed.action == "restore_proposed"
    assert proposed.change is not None

    accepted = await accept_platform_change(
        session_override, tenant.id, proposed.change.id, user.id
    )
    assert accepted.status == "accepted"

    agent = await session_override.get(Agent, created.agent.id)
    assert agent is not None
    assert agent.kind == "company"
    assert agent.is_active is True
    assert agent.managed_origin == "stack"
    assert agent.template_slug == "strategy-optimizer"

    serialized = serialize_agent(agent, view="runtime")
    assert serialized["managed"] is True
    assert serialized["origin_label"] == "Trading"


@pytest.mark.asyncio
async def test_trading_bootstrap_respects_archive(client: AsyncClient, session_override):
    _ = client
    from scripts.tenants.autotrading.bootstrap import (
        STRATEGY_OPTIMIZER_SLUG,
        get_or_create_orchestrator,
    )

    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    first = await get_or_create_orchestrator(session_override, tenant.id)
    await session_override.commit()
    assert first.slug == STRATEGY_OPTIMIZER_SLUG
    assert first.managed_origin == "stack"

    await archive_agent(session_override, tenant.id, first.id)

    again = await get_or_create_orchestrator(session_override, tenant.id)
    assert again.id == first.id
    assert again.kind == "archived"
    assert again.is_active is False

    pending = (
        await session_override.execute(
            select(PlatformChange).where(
                PlatformChange.tenant_id == tenant.id,
                PlatformChange.resource_type == "agent",
                PlatformChange.resource_id == str(first.id),
                PlatformChange.status == "pending_review",
            )
        )
    ).scalars().all()
    assert len(pending) >= 1
    assert any(json.loads(p.after_json or "{}").get("restore") for p in pending)
