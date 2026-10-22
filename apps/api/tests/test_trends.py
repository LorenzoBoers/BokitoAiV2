"""Outward orientation: weekly, client folders in the prompt, one #trend per client."""

from datetime import datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.project import Project
from app.models.signal import Signal, SignalMessage
from app.models.workspace import WorkspaceDoc
from app.services.awareness import ensure_orientations, orientation_prompt
from app.services.signal_tags import signal_tag_names
from app.services.teams import create_team, set_team_members
from app.services.trends import OUTWARD_CRON, post_trend, set_department_lens


async def _setup(session):
    tenant = (await session.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    agent = (await session.execute(select(Agent).where(Agent.tenant_id == tenant.id))).scalars().first()
    team = await create_team(session, tenant.id, name="Research", description="", pickup="people", members=[])
    await set_team_members(session, team, [{"kind": "agent", "id": str(agent.id), "duty": "primary"}])
    set_department_lens(team, "outward")
    session.add(team)
    folder = Project(tenant_id=tenant.id, name="Bakkerij Jansen", slug="bakkerij-jansen")
    session.add(folder)
    await session.flush()
    session.add(WorkspaceDoc(
        tenant_id=tenant.id, project_id=folder.id, path="folders/bakkerij-jansen/profiel.md",
        kind="project_doc", title="Profiel", content="# Profiel\n\nAmbachtelijke bakker in Utrecht, Instagram en TikTok.",
    ))
    await session.commit()
    return tenant, agent, folder


@pytest.mark.asyncio
async def test_outward_orientation_is_weekly_and_lists_clients(client: AsyncClient, session_override):
    tenant, _agent, folder = await _setup(session_override)
    rows = await ensure_orientations(session_override, tenant.id)
    await session_override.commit()
    assert len(rows) == 1 and rows[0].cron_expr == OUTWARD_CRON
    prompt = await orientation_prompt(session_override, rows[0], datetime(2026, 10, 19, 8, 0))
    assert "Bakkerij Jansen" in prompt and str(folder.id) in prompt and "post_trend" in prompt
    assert "Ambachtelijke bakker" in prompt


@pytest.mark.asyncio
async def test_post_trend_files_in_the_folder_once_per_week(client: AsyncClient, session_override):
    tenant, agent, folder = await _setup(session_override)
    assert (await post_trend(session_override, tenant.id, folder_id=folder.id, title="Reels", sources=[]))["error"] == "sources_required"
    result = await post_trend(
        session_override, tenant.id, folder_id=folder.id, title="Carrousels op TikTok",
        for_whom="Bakkerij Jansen", why="Meer bereik", how="Drie carrousels per maand",
        sources=["https://example.com/tiktok"], agent_id=agent.id,
    )
    assert result["status"] == "posted"
    signal = (await session_override.execute(select(Signal).where(Signal.source == "trend"))).scalars().one()
    assert signal.channel == "internal" and "trend" in await signal_tag_names(session_override, signal.id)
    body = (await session_override.execute(select(SignalMessage).where(SignalMessage.signal_id == signal.id))).scalars().first()
    assert "https://example.com/tiktok" in body.body_text
    again = await post_trend(
        session_override, tenant.id, folder_id=folder.id, title="Carrousels op TikTok",
        sources=["https://example.com/tiktok"], agent_id=agent.id,
    )
    assert again["status"] == "exists" and again["signal_id"] == result["signal_id"]
