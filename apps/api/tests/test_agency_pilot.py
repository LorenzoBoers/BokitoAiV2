"""The agency pilot setup builds a complete workspace and stays idempotent."""

import argparse
from contextlib import asynccontextmanager
from uuid import UUID

import pytest
from sqlalchemy import func, select

from app.models.orchestra import Workstream
from app.models.project import Project
from app.models.signal import Signal


@pytest.mark.asyncio
async def test_setup_agency_pilot_is_idempotent(client, session_override, monkeypatch):
    from scripts.dev import setup_agency_pilot as pilot
    from scripts.seed import TEST_EMAIL

    @asynccontextmanager
    async def _factory():
        yield session_override

    monkeypatch.setattr(pilot, "async_session_factory", _factory)
    args = argparse.Namespace(owner_email=TEST_EMAIL, slug="pilot-test", name="Pilot Test", clients="", demo=True)
    first = await pilot.run(args)
    second = await pilot.run(args)

    assert first["flows"] == ["maandcontent", "onboarding", "rapportage", "shoot", "vraag"]
    assert first["demo_conversations"] == 5
    assert second["docs_created"] == 0
    tenant_id = UUID(first["tenant_id"])
    flows = (await session_override.execute(select(Workstream).where(Workstream.tenant_id == tenant_id))).scalars().all()
    by_name = {w.name: w for w in flows}
    assert by_name["Maandcontent"].autonomy == "autonomous"
    assert by_name["Maandcontent"].department_id is not None
    folders = (
        await session_override.execute(select(func.count()).select_from(Project).where(Project.tenant_id == tenant_id))
    ).scalar()
    assert folders == 5
    tickets = (
        await session_override.execute(
            select(func.count()).select_from(Signal).where(Signal.tenant_id == tenant_id, Signal.source == "demo")
        )
    ).scalar()
    assert tickets == 5
