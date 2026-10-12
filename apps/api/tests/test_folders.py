"""Folders are tags with a place: placement follows from a conversation's tags."""

import os
from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.auth import Tenant
from app.models.channel import Company, Contact
from app.models.notification import DecisionRequest
from app.models.project import Project
from app.models.signal import CompanyTagLink, ContactTagLink, Signal, SignalTag
from app.services import folders as svc
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


async def _folder(client, headers, name, **extra) -> dict:
    res = await client.post(
        "/api/folders", headers=headers, json={"name": name, "slug": name.lower().replace(" ", "-"), **extra}
    )
    assert res.status_code == 200, res.text
    return res.json()


async def _tag(client, headers, name, **extra) -> dict:
    res = await client.post("/api/signals/tags", headers=headers, json={"name": name, **extra})
    assert res.status_code == 200, res.text
    return res.json()


async def _thread(client, headers, signal_id) -> dict:
    return (await client.get(f"/api/signals/{signal_id}", headers=headers)).json()["thread"]


@pytest.mark.asyncio
async def test_nested_folders_resolve_to_the_deepest_path(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    clients = await _folder(client, headers, "Clients")
    acme = await _folder(client, headers, "Acme", parent_id=clients["id"])
    q4 = await _folder(client, headers, "Q4", parent_id=acme["id"])
    assert (clients["name"], acme["name"], q4["name"]) == ("clients", "acme", "q4")
    assert (clients["tag_name"], acme["tag_name"], q4["tag_name"]) == ("clients", "acme", "q4")

    signal = await _signal(session_override, tenant.id)
    # #q4 alone does not land: the path needs #clients and #acme too.
    await client.patch(f"/api/signals/{signal.id}", headers=headers, json={"tags": ["q4"]})
    assert (await _thread(client, headers, signal.id))["project_id"] is None
    await client.patch(f"/api/signals/{signal.id}", headers=headers, json={"tags": ["clients", "acme"]})
    assert (await _thread(client, headers, signal.id))["project_id"] == acme["id"]
    await client.patch(f"/api/signals/{signal.id}", headers=headers, json={"tags": ["clients", "acme", "q4"]})
    assert (await _thread(client, headers, signal.id))["project_id"] == q4["id"]

    # Filing in Q4 directly adds all three tags.
    other = await _signal(session_override, tenant.id, "Other")
    res = await client.patch(f"/api/signals/{other.id}", headers=headers, json={"project_id": q4["id"]})
    assert res.status_code == 200, res.text
    thread = await _thread(client, headers, other.id)
    assert thread["project_id"] == q4["id"]
    assert set(thread["tags"]) == {"clients", "acme", "q4"}

    # The folder list filter covers the subtree; a virtual path narrows nothing here.
    listed = await client.get(f"/api/signals?view=all&project_id={clients['id']}", headers=headers)
    assert {row["id"] for row in listed.json()["items"]} == {str(signal.id), str(other.id)}

    # A tag cannot repeat on its own path.
    dup = await client.post(
        "/api/folders",
        headers=headers,
        json={"name": "Acme again", "slug": "acme-again", "parent_id": q4["id"], "tag": "acme"},
    )
    assert dup.status_code == 422


@pytest.mark.asyncio
async def test_group_folder_shows_virtual_children_and_pins_them(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    group = (
        await client.post("/api/signals/tags/groups", headers=headers, json={"name": "Klant", "exclusive": True})
    ).json()
    acme = await _tag(client, headers, "acme", group_id=group["id"])
    beta = await _tag(client, headers, "beta", group_id=group["id"])
    clients = await _folder(client, headers, "Klanten", child_group_id=group["id"])
    facturen = await _folder(client, headers, "Facturen", parent_id=clients["id"], tag="factuur")

    nav = (await client.get("/api/signals/nav", headers=headers)).json()
    root = next(row for row in nav["projects"] if row["id"] == clients["id"])
    names = {(row["name"], row["virtual"]) for row in root["children"]}
    assert names == {("factuur", False), ("acme", True), ("beta", True)}

    # #klanten + #acme lands on the virtual child; the row stays the group folder.
    signal = await _signal(session_override, tenant.id)
    await client.patch(f"/api/signals/{signal.id}", headers=headers, json={"tags": ["klanten", "acme"]})
    thread = await _thread(client, headers, signal.id)
    assert thread["project_id"] == clients["id"]
    tree = await svc.load_tree(session_override, tenant.id)
    placement = tree.resolve({UUID(clients["tag_id"]), UUID(acme["id"])})
    assert placement.path.label == "klanten / acme"
    assert placement.path.virtual_tag_ids == [UUID(acme["id"])]

    # The template child applies under each virtual child.
    placement = tree.resolve({UUID(clients["tag_id"]), UUID(acme["id"]), UUID(facturen["tag_id"])})
    assert placement.path.label == "klanten / acme / factuur"
    assert placement.path.project_id == UUID(facturen["id"])

    # The virtual child's list: subtree plus the tag.
    listed = await client.get(
        f"/api/signals?view=all&project_id={clients['id']}&path={acme['id']}", headers=headers
    )
    assert {row["id"] for row in listed.json()["items"]} == {str(signal.id)}
    listed = await client.get(
        f"/api/signals?view=all&project_id={clients['id']}&path={beta['id']}", headers=headers
    )
    assert listed.json()["items"] == []

    # Pinning makes a real row with the tag; the conversation is already there.
    pinned = await client.post(
        f"/api/folders/{clients['id']}/children", headers=headers, json={"tag_id": acme["id"]}
    )
    assert pinned.status_code == 200, pinned.text
    assert pinned.json()["tag_id"] == acme["id"]
    assert pinned.json()["parent_id"] == clients["id"]
    thread = await _thread(client, headers, signal.id)
    assert thread["project_id"] == pinned.json()["id"]
    nav = (await client.get("/api/signals/nav", headers=headers)).json()
    root = next(row for row in nav["projects"] if row["id"] == clients["id"])
    assert {(row["name"], row["virtual"]) for row in root["children"]} == {
        ("factuur", False),
        ("acme", False),
        ("beta", True),
    }

    # The group is exclusive: #beta replaces #acme, and the thread moves.
    await client.patch(f"/api/signals/{signal.id}", headers=headers, json={"tags": ["klanten", "acme", "beta"]})
    thread = await _thread(client, headers, signal.id)
    assert "acme" not in thread["tags"] and "beta" in thread["tags"]
    assert thread["project_id"] == clients["id"]


@pytest.mark.asyncio
async def test_contact_and_company_tags_place_every_thread(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    acme = await _folder(client, headers, "Acme")
    vip = await _folder(client, headers, "VIP")
    company = Company(tenant_id=tenant.id, name="Acme BV", domain="acme.test")
    session_override.add(company)
    await session_override.flush()
    contact = Contact(tenant_id=tenant.id, channel="email", address="jo@acme.test", company_id=company.id)
    session_override.add(contact)
    await session_override.commit()

    signal = await _signal(session_override, tenant.id, "From Jo", contact_id=contact.id)
    assert signal.project_id is None

    session_override.add(CompanyTagLink(company_id=company.id, tag_id=UUID(acme["tag_id"]), tenant_id=tenant.id))
    await session_override.commit()
    moved = await svc.refile_tagged(session_override, tenant.id, [UUID(acme["tag_id"])])
    await session_override.commit()
    assert moved == 1
    thread = await _thread(client, headers, signal.id)
    assert thread["project_id"] == acme["id"]
    # Inherited: not copied onto the conversation.
    assert "acme" not in thread["tags"]
    listed = await client.get("/api/signals?view=all&tag=acme", headers=headers)
    assert {row["id"] for row in listed.json()["items"]} == {str(signal.id)}

    # A second root tag ties at depth 1: keep the current home, no question card.
    session_override.add(ContactTagLink(contact_id=contact.id, tag_id=UUID(vip["tag_id"]), tenant_id=tenant.id))
    await session_override.commit()
    await svc.refile_tagged(session_override, tenant.id, [UUID(vip["tag_id"])])
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
    paths = {tuple(row["tags"]) for row in thread.get("folder_paths") or []}
    assert paths == {("acme",), ("vip",)}
    listed_acme = await client.get(f"/api/signals?view=all&project_id={acme['id']}", headers=headers)
    listed_vip = await client.get(f"/api/signals?view=all&project_id={vip['id']}", headers=headers)
    assert {row["id"] for row in listed_acme.json()["items"]} == {str(signal.id)}
    assert {row["id"] for row in listed_vip.json()["items"]} == {str(signal.id)}


@pytest.mark.asyncio
async def test_trash_and_restore_refile(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    acme = await _folder(client, headers, "Acme")
    signal = await _signal(session_override, tenant.id)
    await client.patch(f"/api/signals/{signal.id}", headers=headers, json={"tags": ["acme"]})
    assert (await _thread(client, headers, signal.id))["project_id"] == acme["id"]

    deleted = await client.request(
        "DELETE", f"/api/folders/{acme['id']}", headers=headers, json={"confirm_name": "acme"}
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
    acme = await _folder(client, headers, "Acme")
    refused = await client.delete(f"/api/signals/tags/{acme['tag_id']}", headers=headers)
    assert refused.status_code == 409

    other = await _tag(client, headers, "acme-old")
    renamed = await client.patch(f"/api/signals/tags/{other['id']}", headers=headers, json={"name": "acme"})
    assert renamed.status_code == 200, renamed.text
    tags = {row["name"]: row for row in (await client.get("/api/signals/tags", headers=headers)).json()}
    assert "acme-old" not in tags
    row = await session_override.get(Project, UUID(acme["id"]))
    await session_override.refresh(row)
    assert str(row.tag_id) == tags["acme"]["id"]
    tag = await session_override.get(SignalTag, row.tag_id)
    assert tag is not None and tag.name == "acme"


@pytest.mark.asyncio
async def test_contact_and_company_tag_routes_refile(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    acme = await _folder(client, headers, "Acme")
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
    assert [row["name"] for row in put.json()["tags"]] == ["acme"]
    thread = await _thread(client, headers, signal.id)
    assert thread["project_id"] == acme["id"]
    assert "acme" not in thread["tags"]
    assert "acme" in thread.get("inherited_tags", [])

    got = await client.get(f"/api/channels/contacts/{contact.id}/tags", headers=headers)
    assert got.status_code == 200
    assert [row["name"] for row in got.json()["tags"]] == ["acme"]


@pytest.mark.asyncio
async def test_ai_catalog_includes_group_and_folder_path(client: AsyncClient, session_override):
    from app.services.signal_tags import ai_catalog_lines, create_group, update_tag

    headers = await _login(client)
    tenant = await _tenant(session_override)
    acme = await _folder(client, headers, "Acme")
    group = await create_group(session_override, tenant.id, "Client", exclusive=True)
    await update_tag(
        session_override,
        tenant.id,
        UUID(acme["tag_id"]),
        group_id=group.id,
        ai_auto_tag=True,
        description="This client",
    )

    lines = await ai_catalog_lines(session_override, tenant.id)
    assert any("#acme" in line and "acme" in line.lower() for line in lines)


@pytest.mark.asyncio
async def test_one_thread_lists_in_two_folder_paths(client: AsyncClient, session_override):
    headers = await _login(client)
    tenant = await _tenant(session_override)
    acme = await _folder(client, headers, "Acme")
    partner = await _folder(client, headers, "Partner")
    invoices = await _folder(client, headers, "Facturen", parent_id=acme["id"])
    partner_invoices = await _folder(client, headers, "Facturen", parent_id=partner["id"])
    assert invoices["tag_id"] == partner_invoices["tag_id"]

    signal = await _signal(session_override, tenant.id)
    await client.patch(
        f"/api/signals/{signal.id}",
        headers=headers,
        json={"tags": ["acme", "partner", "facturen"]},
    )
    thread = await _thread(client, headers, signal.id)
    paths = {tuple(row["tags"]) for row in thread.get("folder_paths") or []}
    assert paths == {("acme", "facturen"), ("partner", "facturen")}

    in_acme = await client.get(f"/api/signals?view=all&project_id={invoices['id']}", headers=headers)
    in_partner = await client.get(
        f"/api/signals?view=all&project_id={partner_invoices['id']}", headers=headers
    )
    assert {row["id"] for row in in_acme.json()["items"]} == {str(signal.id)}
    assert {row["id"] for row in in_partner.json()["items"]} == {str(signal.id)}

    nav = (await client.get("/api/signals/nav", headers=headers)).json()
    roots = {row["name"]: row for row in nav["projects"]}
    assert roots["acme"]["count"] == 1
    assert roots["partner"]["count"] == 1
    acme_child = next(row for row in roots["acme"]["children"] if row["name"] == "facturen")
    assert acme_child["count"] == 1
