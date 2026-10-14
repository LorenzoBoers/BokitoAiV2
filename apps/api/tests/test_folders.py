"""Folders are saved AND tag filtersets; placement follows from a conversation's tags."""

import os
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.auth import Tenant
from app.models.channel import Company, Contact
from app.models.notification import DecisionRequest
from app.models.project import ProjectTagLink
from app.models.signal import CompanyTagLink, ContactTagLink, Signal
from app.services import folders as svc
from app.services.folders import longest_match
from scripts.seed import TEST_EMAIL, TEST_PASSWORD

os.environ["BOKITO_MOCK_EXECUTION"] = "true"


async def _login(client: AsyncClient) -> dict[str, str]:
    res = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    return {"Authorization": f"Bearer {res.json()['access_token']}"}


async def _tenant(session) -> Tenant:
    return (await session.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()


async def _signal(session, tenant_id, subject="Thread", contact_id=None) -> Signal:
    signal = Signal(
        tenant_id=tenant_id, channel="widget", source="widget", subject=subject, status="open", contact_id=contact_id
    )
    session.add(signal)
    await session.commit()
    await session.refresh(signal)
    return signal


def _primary_tag(folder: dict) -> str:
    names = folder.get("tag_names") or []
    return names[-1] if names else ""


def _primary_tag_id(folder: dict) -> str:
    ids = folder.get("tag_ids") or []
    return ids[-1] if ids else ""


async def _folder(client, headers, name, *, parent_id=None, tags=None, **extra) -> dict:
    slug = name.lower().replace(" ", "-")
    body = {"name": name, "slug": slug, "tags": tags or [slug]}
    body.update({k: v for k, v in extra.items() if k not in ("parent_id", "child_group_id", "tag")})
    if extra.get("tag"):
        body["tags"] = [extra["tag"]]
    res = await client.post("/api/folders", headers=headers, json=body)
    assert res.status_code == 200, res.text
    data = res.json()
    if parent_id:
        nest = await client.post(
            f"/api/folders/{data['id']}/nest",
            headers=headers,
            json={"onto_folder_id": parent_id},
        )
        assert nest.status_code == 200, nest.text
        data = nest.json()
    return data


async def _thread(client, headers, signal_id) -> dict:
    return (await client.get(f"/api/signals/{signal_id}", headers=headers)).json()["thread"]


@pytest.mark.asyncio
async def test_nested_folders_resolve_to_the_deepest_path(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    clients = await _folder(client, headers, "Clients", tags=["clients"])
    acme = await _folder(client, headers, "Acme", tags=["acme"], parent_id=clients["id"])
    q4 = await _folder(client, headers, "Q4", tags=["q4"], parent_id=acme["id"])
    assert _primary_tag(clients) == "clients"
    assert _primary_tag(acme) == "acme"
    assert _primary_tag(q4) == "q4"

    signal = await _signal(session_override, tenant.id)
    await client.patch(f"/api/signals/{signal.id}", headers=headers, json={"tags": ["q4"]})
    assert (await _thread(client, headers, signal.id))["project_id"] is None
    await client.patch(f"/api/signals/{signal.id}", headers=headers, json={"tags": ["clients", "acme"]})
    assert (await _thread(client, headers, signal.id))["project_id"] == acme["id"]
    await client.patch(f"/api/signals/{signal.id}", headers=headers, json={"tags": ["clients", "acme", "q4"]})
    assert (await _thread(client, headers, signal.id))["project_id"] == q4["id"]

    other = await _signal(session_override, tenant.id, "Other")
    res = await client.patch(f"/api/signals/{other.id}", headers=headers, json={"project_id": q4["id"]})
    assert res.status_code == 200, res.text
    thread = await _thread(client, headers, other.id)
    assert thread["project_id"] == q4["id"]
    assert set(thread["tags"]) == {"clients", "acme", "q4"}

    listed = await client.get(f"/api/signals?view=all&project_id={clients['id']}", headers=headers)
    assert {row["id"] for row in listed.json()["items"]} == {str(signal.id), str(other.id)}


@pytest.mark.asyncio
async def test_group_folder_path_filter(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    group = (
        await client.post("/api/signals/tags/groups", headers=headers, json={"name": "Klant", "exclusive": True})
    ).json()
    acme = (
        await client.post("/api/signals/tags", headers=headers, json={"name": "acme", "group_id": group["id"]})
    ).json()
    beta = (
        await client.post("/api/signals/tags", headers=headers, json={"name": "beta", "group_id": group["id"]})
    ).json()
    clients = await _folder(client, headers, "Klanten", tags=["klanten"])
    facturen = await _folder(client, headers, "Facturen", tag="factuur", parent_id=clients["id"])

    signal = await _signal(session_override, tenant.id)
    await client.patch(f"/api/signals/{signal.id}", headers=headers, json={"tags": ["klanten", "acme"]})
    thread = await _thread(client, headers, signal.id)
    assert thread["project_id"] == clients["id"]

    catalog = await svc.load_catalog(session_override, tenant.id)
    hit = longest_match(catalog, {UUID(clients["tag_ids"][0]), UUID(acme["id"])})
    assert hit is not None and hit.id == UUID(clients["id"])

    listed = await client.get(
        f"/api/signals?view=all&project_id={clients['id']}&path={acme['id']}", headers=headers
    )
    assert {row["id"] for row in listed.json()["items"]} == {str(signal.id)}
    listed = await client.get(
        f"/api/signals?view=all&project_id={clients['id']}&path={beta['id']}", headers=headers
    )
    assert listed.json()["items"] == []

    await client.patch(
        f"/api/signals/{signal.id}",
        headers=headers,
        json={"tags": ["klanten", "acme", "factuur"]},
    )
    catalog = await svc.load_catalog(session_override, tenant.id)
    eff = {UUID(clients["tag_ids"][0]), UUID(acme["id"]), UUID(facturen["tag_ids"][-1])}
    match = longest_match(catalog, eff)
    assert match is not None and match.id == UUID(facturen["id"])

    await client.patch(f"/api/signals/{signal.id}", headers=headers, json={"tags": ["klanten", "acme", "beta"]})
    thread = await _thread(client, headers, signal.id)
    assert "acme" not in thread["tags"] and "beta" in thread["tags"]


@pytest.mark.asyncio
async def test_contact_and_company_tags_place_every_thread(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    acme = await _folder(client, headers, "Acme", tags=["acme"])
    vip = await _folder(client, headers, "VIP", tags=["vip"])
    company = Company(tenant_id=tenant.id, name="Acme BV", domain="acme.test")
    session_override.add(company)
    await session_override.flush()
    contact = Contact(tenant_id=tenant.id, channel="email", address="jo@acme.test", company_id=company.id)
    session_override.add(contact)
    await session_override.commit()

    signal = await _signal(session_override, tenant.id, "From Jo", contact_id=contact.id)
    assert signal.project_id is None

    session_override.add(CompanyTagLink(company_id=company.id, tag_id=UUID(acme["tag_ids"][0]), tenant_id=tenant.id))
    await session_override.commit()
    moved = await svc.refile_tagged(session_override, tenant.id, [UUID(acme["tag_ids"][0])])
    await session_override.commit()
    assert moved == 1
    thread = await _thread(client, headers, signal.id)
    assert thread["project_id"] == acme["id"]
    assert "acme" not in thread["tags"]
    listed = await client.get("/api/signals?view=all&tag=acme", headers=headers)
    assert {row["id"] for row in listed.json()["items"]} == {str(signal.id)}

    session_override.add(ContactTagLink(contact_id=contact.id, tag_id=UUID(vip["tag_ids"][0]), tenant_id=tenant.id))
    await session_override.commit()
    await svc.refile_tagged(session_override, tenant.id, [UUID(vip["tag_ids"][0])])
    await session_override.commit()
    thread = await _thread(client, headers, signal.id)
    assert thread["project_id"] == acme["id"]
    decisions = (
        await session_override.execute(
            select(DecisionRequest).where(
                DecisionRequest.signal_id == signal.id, DecisionRequest.source_type == svc.FOLDER_DECISION_SOURCE
            )
        )
    ).scalars().all()
    assert decisions == []
    paths = {tuple(row["tag_names"]) for row in thread.get("folder_paths") or []}
    assert paths == {("acme",), ("vip",)}
    listed_acme = await client.get(f"/api/signals?view=all&project_id={acme['id']}", headers=headers)
    listed_vip = await client.get(f"/api/signals?view=all&project_id={vip['id']}", headers=headers)
    assert {row["id"] for row in listed_acme.json()["items"]} == {str(signal.id)}
    assert {row["id"] for row in listed_vip.json()["items"]} == {str(signal.id)}


@pytest.mark.asyncio
async def test_trash_and_restore_refile(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    acme = await _folder(client, headers, "Acme", tags=["acme"])
    signal = await _signal(session_override, tenant.id)
    await client.patch(f"/api/signals/{signal.id}", headers=headers, json={"tags": ["acme"]})
    assert (await _thread(client, headers, signal.id))["project_id"] == acme["id"]

    deleted = await client.request(
        "DELETE", f"/api/folders/{acme['id']}", headers=headers, json={"confirm_name": acme["name"]}
    )
    assert deleted.status_code == 200, deleted.text
    thread = await _thread(client, headers, signal.id)
    assert thread["project_id"] is None
    assert "acme" in thread["tags"]

    trash = (await client.get("/api/trash", headers=headers)).json()
    entry = next(item for item in trash["items"] if item["resource_type"] == "project")
    restored = await client.post(f"/api/trash/{entry['id']}/restore", headers=headers)
    assert restored.status_code == 200, restored.text
    assert (await _thread(client, headers, signal.id))["project_id"] == acme["id"]


@pytest.mark.asyncio
async def test_folder_tag_cannot_be_deleted_and_merge_moves_folder(client: AsyncClient, session_override):
    headers = await _login(client)
    acme = await _folder(client, headers, "Acme", tags=["acme"])
    refused = await client.delete(f"/api/signals/tags/{acme['tag_ids'][0]}", headers=headers)
    assert refused.status_code == 409

    other = (
        await client.post("/api/signals/tags", headers=headers, json={"name": "acme-old"})
    ).json()
    renamed = await client.patch(f"/api/signals/tags/{other['id']}", headers=headers, json={"name": "acme"})
    assert renamed.status_code == 200, renamed.text
    tags = {row["name"]: row for row in (await client.get("/api/signals/tags", headers=headers)).json()}
    assert "acme-old" not in tags
    link = (
        await session_override.execute(
            select(ProjectTagLink).where(ProjectTagLink.project_id == UUID(acme["id"]))
        )
    ).scalar_one()
    assert str(link.tag_id) == tags["acme"]["id"]


@pytest.mark.asyncio
async def test_contact_and_company_tag_routes_refile(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    acme = await _folder(client, headers, "Acme", tags=["acme"])
    company = Company(tenant_id=tenant.id, name="Acme BV", domain="acme.test")
    session_override.add(company)
    await session_override.flush()
    contact = Contact(tenant_id=tenant.id, channel="email", address="jo@acme.test", company_id=company.id)
    session_override.add(contact)
    await session_override.commit()
    signal = await _signal(session_override, tenant.id, "From Jo", contact_id=contact.id)

    put = await client.put(
        f"/api/channels/contacts/{contact.id}/tags", headers=headers, json={"tags": ["acme"]}
    )
    assert put.status_code == 200, put.text
    thread = await _thread(client, headers, signal.id)
    assert thread["project_id"] == acme["id"]
    assert "acme" not in thread["tags"]
    assert "acme" in thread.get("inherited_tags", [])


@pytest.mark.asyncio
async def test_ai_catalog_includes_group_and_folder_path(client: AsyncClient, session_override):
    from app.services.signal_tags import ai_catalog_lines, create_group, update_tag

    headers = await _login(client)
    tenant = await _tenant(session_override)
    acme = await _folder(client, headers, "Acme", tags=["acme"])
    group = await create_group(session_override, tenant.id, "Client", exclusive=True)
    await update_tag(
        session_override,
        tenant.id,
        UUID(acme["tag_ids"][0]),
        group_id=group.id,
        ai_auto_tag=True,
        description="This client",
    )

    lines = await ai_catalog_lines(session_override, tenant.id)
    assert any("#acme" in line and "acme" in line.lower() for line in lines)


@pytest.mark.asyncio
async def test_one_thread_lists_in_two_folder_paths(client: AsyncClient, session_override):
    headers = await _login(client)
    await _tenant(session_override)
    acme = await _folder(client, headers, "Acme", tags=["acme"])
    partner = await _folder(client, headers, "Partner", tags=["partner"])
    invoices = await _folder(client, headers, "Facturen", tags=["facturen"], parent_id=acme["id"])
    partner_invoices = await _folder(client, headers, "Facturen", tags=["facturen"], parent_id=partner["id"])
    assert invoices["tag_ids"][-1] == partner_invoices["tag_ids"][-1]

    signal = await _signal(session_override, (await _tenant(session_override)).id)
    await client.patch(
        f"/api/signals/{signal.id}",
        headers=headers,
        json={"tags": ["acme", "partner", "facturen"]},
    )
    thread = await _thread(client, headers, signal.id)
    paths = {frozenset(row["tag_names"]) for row in thread.get("folder_paths") or []}
    assert paths == {frozenset(["acme", "facturen"]), frozenset(["partner", "facturen"])}

    in_acme = await client.get(f"/api/signals?view=all&project_id={invoices['id']}", headers=headers)
    in_partner = await client.get(
        f"/api/signals?view=all&project_id={partner_invoices['id']}", headers=headers
    )
    assert {row["id"] for row in in_acme.json()["items"]} == {str(signal.id)}
    assert {row["id"] for row in in_partner.json()["items"]} == {str(signal.id)}

    nav = (await client.get("/api/signals/nav", headers=headers)).json()
    roots = {row["name"].lower(): row for row in nav["projects"] if row.get("project_id")}
    assert any("acme" in k or v.get("tag_ids") for k, v in roots.items())
    # Counts on derived tree rows
    assert any(row.get("count", 0) >= 1 for row in nav["projects"])


@pytest.mark.asyncio
async def test_folder_filterset_must_be_unique(client: AsyncClient, session_override):
    headers = await _login(client)
    first = await _folder(client, headers, "Admin", tags=["administratie", "overig"])
    assert set(first["tag_names"]) == {"administratie", "overig"}

    dup = await client.post(
        "/api/folders",
        headers=headers,
        json={"tags": ["overig", "administratie"]},
    )
    assert dup.status_code == 409, dup.text
    assert "already exists" in (dup.json().get("detail") or "").lower()

    other = await _folder(client, headers, "OnlyOverig", tags=["overig"])
    assert other["tag_names"] == ["overig"]

    # Editing an existing folder into a taken set is also blocked.
    conflict = await client.patch(
        f"/api/folders/{other['id']}",
        headers=headers,
        json={"tags": ["administratie", "overig"]},
    )
    assert conflict.status_code == 409, conflict.text
