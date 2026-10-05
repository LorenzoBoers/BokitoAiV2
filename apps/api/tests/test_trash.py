"""Workspace Bin: move-to-bin, hide from lists, restore, purge, inbound restore."""

from __future__ import annotations

from datetime import datetime, timedelta
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _login(client: AsyncClient) -> dict[str, str]:
    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


async def _create_thread(client: AsyncClient, headers: dict, subject: str) -> str:
    r = await client.post(
        "/api/signals/inbound",
        headers=headers,
        json={
            "channel": "email",
            "source": "test",
            "subject": subject,
            "body_text": "hello",
            "contact_email": "bin-customer@example.com",
            "contact_name": "Bin Customer",
        },
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


@pytest.mark.asyncio
async def test_conversation_and_project_bin_restore_purge(client: AsyncClient, session_override):
    from app.models.project import Project
    from app.models.signal import Signal
    from app.models.trash import TrashEntry
    from app.services.trash import load_tenant, purge_expired_trash

    headers = await _login(client)
    signal_id = await _create_thread(client, headers, "Bin me")
    sig_uuid = UUID(signal_id)

    deleted = await client.delete(f"/api/signals/{signal_id}", headers=headers)
    assert deleted.status_code == 200, deleted.text

    row = (await session_override.execute(select(Signal).where(Signal.id == sig_uuid))).scalar_one()
    assert row.deleted_at is not None

    listed = await client.get("/api/signals", headers=headers)
    assert listed.status_code == 200
    ids = [item.get("id") for item in listed.json().get("items", [])]
    assert signal_id not in ids

    bin_list = await client.get("/api/trash", headers=headers)
    assert bin_list.status_code == 200, bin_list.text
    entry = next(i for i in bin_list.json()["items"] if i["resource_id"] == signal_id)
    asserted_signal_alias = await client.get("/api/trash?type=signal", headers=headers)
    assert asserted_signal_alias.status_code == 200
    assert any(i["id"] == entry["id"] for i in asserted_signal_alias.json()["items"])
    as_conversation = await client.get("/api/trash?type=conversation", headers=headers)
    assert any(i["id"] == entry["id"] for i in as_conversation.json()["items"])

    restored = await client.post(f"/api/trash/{entry['id']}/restore", headers=headers)
    assert restored.status_code == 200, restored.text
    live = (await session_override.execute(select(Signal).where(Signal.id == sig_uuid))).scalar_one()
    assert live.deleted_at is None

    proj = await client.post(
        "/api/workforce/projects",
        headers=headers,
        json={
            "name": "Bin Project",
            "slug": "bin-project-restore",
            "autonomous_scope": "ops",
        },
    )
    assert proj.status_code == 200, proj.text
    project_id = proj.json()["id"]
    gone = await client.request(
        "DELETE",
        f"/api/workforce/projects/{project_id}",
        headers=headers,
        json={"confirm_name": "Bin Project"},
    )
    assert gone.status_code == 200, gone.text
    again = await client.post(
        "/api/workforce/projects",
        headers=headers,
        json={
            "name": "Bin Project 2",
            "slug": "bin-project-restore",
            "autonomous_scope": "ops",
        },
    )
    assert again.status_code == 200, again.text
    bin_list = await client.get("/api/trash?type=project", headers=headers)
    entry = next(i for i in bin_list.json()["items"] if i["resource_id"] == project_id)
    back = await client.post(f"/api/trash/{entry['id']}/restore", headers=headers)
    assert back.status_code == 200, back.text
    restored_row = (
        await session_override.execute(select(Project).where(Project.id == UUID(project_id)))
    ).scalar_one()
    assert restored_row.deleted_at is None
    assert restored_row.slug.startswith("bin-project-restore")

    tenant = await load_tenant(session_override, restored_row.tenant_id)
    confirm = restored_row.name
    gone2 = await client.request(
        "DELETE",
        f"/api/workforce/projects/{project_id}",
        headers=headers,
        json={"confirm_name": confirm},
    )
    assert gone2.status_code == 200, gone2.text
    entry = next(
        i
        for i in (await client.get("/api/trash?type=project", headers=headers)).json()["items"]
        if i["resource_id"] == project_id
    )
    trash_row = (
        await session_override.execute(select(TrashEntry).where(TrashEntry.id == UUID(entry["id"])))
    ).scalar_one()
    trash_row.purge_after = datetime.utcnow() - timedelta(days=1)
    session_override.add(trash_row)
    await session_override.commit()
    n = await purge_expired_trash(session_override, tenant)
    assert n >= 1
    assert (
        await session_override.execute(select(Project).where(Project.id == UUID(project_id)))
    ).scalar_one_or_none() is None


@pytest.mark.asyncio
async def test_inbound_restores_binned_conversation(client: AsyncClient, session_override):
    from app.models.signal import Signal
    from app.services.signals import _open_thread_for_inbound
    from app.services.trash import load_tenant, move_to_bin

    headers = await _login(client)
    signal_id = await _create_thread(client, headers, "Mail thread")
    signal = (
        await session_override.execute(select(Signal).where(Signal.id == UUID(signal_id)))
    ).scalar_one()
    signal.external_id = "ext-bin-1"
    signal.channel = "email"
    session_override.add(signal)
    tenant = await load_tenant(session_override, signal.tenant_id)
    await move_to_bin(
        session_override,
        tenant,
        resource_type="conversation",
        row=signal,
        user_id=None,
        commit=True,
    )
    found = await _open_thread_for_inbound(
        session_override,
        signal.tenant_id,
        channel="email",
        contact_id=None,
        contact_email="ada@example.com",
        subject="Mail thread",
        external_id="ext-bin-1",
    )
    assert found is not None
    await session_override.refresh(found)
    assert found.id == signal.id
    assert found.deleted_at is None
