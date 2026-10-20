"""Works in: the places inside a folder where work lands."""

from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.auth import Tenant
from app.models.project import Project
from app.services import works_in
from scripts.seed import TEST_EMAIL, TEST_PASSWORD

API = "/api/folders"


async def _login(client: AsyncClient) -> dict[str, str]:
    res = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert res.status_code == 200
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def _folder(client: AsyncClient, headers, slug="works-in") -> str:
    created = await client.post(API, headers=headers, json={"name": "Klant A", "slug": slug, "tags": [slug]})
    assert created.status_code == 200
    return created.json()["id"]


@pytest.mark.asyncio
async def test_empty_folder_has_no_items(client: AsyncClient, session_override):
    headers = await _login(client)
    folder_id = await _folder(client, headers)
    res = await client.get(f"{API}/{folder_id}/works-in", headers=headers)
    assert res.status_code == 200
    assert res.json() == {"items": []}


@pytest.mark.asyncio
async def test_add_canvas_and_drive(client: AsyncClient, session_override):
    headers = await _login(client)
    folder_id = await _folder(client, headers)

    canvas = await client.post(
        f"{API}/{folder_id}/works-in", headers=headers, json={"kind": "canvas", "title": "Cijfers"}
    )
    assert canvas.status_code == 200
    item = canvas.json()["item"]
    assert item["kind"] == "canvas"
    assert item["origin"] == "bokito"
    assert item["label"] == "Cijfers"
    assert item["key"].startswith("canvas:")
    assert item["href"].startswith(f"/folders/{folder_id}?tab=canvas&canvas=")

    drive = await client.post(
        f"{API}/{folder_id}/works-in",
        headers=headers,
        json={"kind": "drive", "title": "Contracten", "provider": "google_drive", "external_ref": "https://drive.example/x"},
    )
    assert drive.status_code == 200
    assert drive.json()["item"]["origin"] == "connection"
    assert drive.json()["item"]["href"] == "https://drive.example/x"

    listed = await client.get(f"{API}/{folder_id}/works-in", headers=headers)
    kinds = [i["kind"] for i in listed.json()["items"]]
    assert kinds == ["canvas", "drive"]


@pytest.mark.asyncio
async def test_unknown_kind_and_unknown_folder(client: AsyncClient, session_override):
    headers = await _login(client)
    folder_id = await _folder(client, headers)
    bad = await client.post(f"{API}/{folder_id}/works-in", headers=headers, json={"kind": "repo"})
    assert bad.status_code == 422
    missing = await client.get(f"{API}/00000000-0000-0000-0000-000000000000/works-in", headers=headers)
    assert missing.status_code == 404


@pytest.mark.asyncio
async def test_item_for_key_accepts_empty_board(client: AsyncClient, session_override):
    headers = await _login(client)
    folder_id = await _folder(client, headers)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    item = await works_in.item_for_key(session_override, tenant.id, UUID(folder_id), "board")
    assert item is not None and item["count"] == 0
    assert await works_in.item_for_key(session_override, tenant.id, UUID(folder_id), "canvas:nope") is None


async def _module_folder(session, tenant_id) -> Project | None:
    return (
        await session.execute(
            select(Project).where(
                Project.tenant_id == tenant_id,
                Project.name.in_(("Administration", "Administratie")),
                Project.deleted_at.is_(None),
            )
        )
    ).scalars().first()


@pytest.mark.asyncio
async def test_accounting_install_creates_folder_with_canvas(client: AsyncClient, session_override):
    from app.modules.catalog import install_module

    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    await install_module(session_override, tenant.id, "accounting", hire_specialist=False)
    folder = await _module_folder(session_override, tenant.id)
    assert folder is not None and folder.department_id is not None
    items = await works_in.works_in_items(session_override, tenant.id, folder.id)
    assert [(i["kind"], i["label"]) for i in items] in ([("canvas", "Figures")], [("canvas", "Cijfers")])


@pytest.mark.asyncio
async def test_accounting_install_links_active_connection(client: AsyncClient, session_override):
    from app.models.integration import IntegrationConnection
    from app.modules.catalog import install_module

    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    session_override.add(
        IntegrationConnection(
            tenant_id=tenant.id, provider="moneybird", display_name="Moneybird 2026", instance_key="1"
        )
    )
    await session_override.commit()
    await install_module(session_override, tenant.id, "accounting", hire_specialist=False)
    folder = await _module_folder(session_override, tenant.id)
    assert folder is not None
    items = await works_in.works_in_items(session_override, tenant.id, folder.id)
    assert len(items) == 1
    assert items[0]["origin"] == "connection"
    assert items[0]["label"] == "Moneybird 2026"


@pytest.mark.asyncio
async def test_general_folder_is_created_once(client: AsyncClient, session_override):
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    first = await works_in.general_folder(session_override, tenant.id)
    second = await works_in.general_folder(session_override, tenant.id)
    assert first is not None and first.id == second.id
    assert first.name in ("Algemeen", "General")
    rows = (
        await session_override.execute(
            select(Project).where(Project.tenant_id == tenant.id, Project.name == first.name)
        )
    ).scalars().all()
    assert len(rows) == 1
