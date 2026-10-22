"""Content calendar entries with a Sheet mirror, and the customer's verdict."""

import json

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.auth import Tenant
from app.models.orchestra import Workstream
from app.models.project import Project
from app.models.project_work import ProjectResource
from app.models.signal import Signal, SignalEvent, SignalTag
from app.services import content_calendar
from app.services.client_approval import apply_verdict
from app.services.project_work import create_queue_item, update_queue_item
from app.services.workspace import list_docs

STAGES = [
    {"key": "captions", "name": "Captions", "kind": "waiting", "waiting_on": "us"},
    {"key": "klant-akkoord", "name": "Klant akkoord", "kind": "waiting", "waiting_on": "customer"},
    {"key": "ingepland", "name": "Ingepland", "kind": "done"},
]


async def _folder(session):
    tenant = (await session.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    folder = Project(tenant_id=tenant.id, name="Bakkerij", slug="bakkerij")
    session.add(folder)
    await session.commit()
    return tenant, folder


@pytest.mark.asyncio
async def test_calendar_entry_mirrors_to_the_sheet(client: AsyncClient, session_override, monkeypatch):
    tenant, folder = await _folder(session_override)
    calls = []

    async def fake_call_verb(session, tenant_id, verb, args, **kwargs):
        calls.append((verb, args))
        return {"ok": True, "updated": args["range"]}

    monkeypatch.setattr("app.modules.documents.router.call_verb", fake_call_verb)
    item = await create_queue_item(
        session_override, tenant.id, folder.id, kind="post", title="Seizoensbrood",
        fields={"date": "2026-11-03", "channel": "instagram", "caption": "Vers uit de oven", "extra": "x"},
    )
    assert content_calendar.item_fields(item) == {"date": "2026-11-03", "channel": "instagram", "caption": "Vers uit de oven"}
    assert calls == []

    session_override.add(ProjectResource(
        tenant_id=tenant.id, project_id=folder.id, resource_type="sheet", provider="google_drive",
        external_ref="sheet-123", config_json=json.dumps({"tab": "Planning"}),
    ))
    await session_override.commit()
    await update_queue_item(session_override, tenant.id, item.id, fields={"image": "https://example.org/a.jpg"})
    verb, args = calls[-1]
    assert verb == "sheets_update" and args["spreadsheet_id"] == "sheet-123"
    assert args["range"] == "Planning!A1:F2"
    assert args["values"][1][:5] == ["2026-11-03", "instagram", "Seizoensbrood", "Vers uit de oven", "https://example.org/a.jpg"]


async def _ticket(session, tenant, folder, stage_key):
    flow = Workstream(tenant_id=tenant.id, name="Maandcontent", stages_json=json.dumps(STAGES))
    session.add(flow)
    await session.flush()
    tag = SignalTag(tenant_id=tenant.id, name="maandcontent", workstream_id=flow.id)
    session.add(tag)
    await session.flush()
    signal = Signal(
        tenant_id=tenant.id, channel="email", source="email", subject="Posts november",
        ticket_tag_id=tag.id, ticket_status="waiting", stage_key=stage_key, project_id=folder.id,
    )
    session.add(signal)
    await session.commit()
    return signal


@pytest.mark.asyncio
async def test_approval_moves_forward(client: AsyncClient, session_override):
    tenant, folder = await _folder(session_override)
    signal = await _ticket(session_override, tenant, folder, "klant-akkoord")
    out = await apply_verdict(session_override, signal, "approved")
    await session_override.commit()
    assert out["applied"] is True and signal.stage_key == "ingepland" and signal.ticket_status == "done"


@pytest.mark.asyncio
async def test_changes_go_back_and_land_in_agreements(client: AsyncClient, session_override):
    tenant, folder = await _folder(session_override)
    signal = await _ticket(session_override, tenant, folder, "klant-akkoord")
    out = await apply_verdict(session_override, signal, "changes_requested", feedback="Geen foto's van de behandelkamer.")
    await session_override.commit()
    assert out["applied"] is True and signal.stage_key == "captions"
    docs = await list_docs(session_override, tenant.id, project_id=folder.id)
    agreements = next(d for d in docs if d.title == "Afspraken")
    assert "behandelkamer" in agreements.content
    events = (
        await session_override.execute(select(SignalEvent).where(SignalEvent.signal_id == signal.id, SignalEvent.event_type == "client_verdict"))
    ).scalars().all()
    assert json.loads(events[0].payload_json)["verdict"] == "changes_requested"


@pytest.mark.asyncio
async def test_verdict_only_on_a_customer_stage(client: AsyncClient, session_override):
    tenant, folder = await _folder(session_override)
    signal = await _ticket(session_override, tenant, folder, "captions")
    out = await apply_verdict(session_override, signal, "approved")
    assert out["applied"] is False and signal.stage_key == "captions"
