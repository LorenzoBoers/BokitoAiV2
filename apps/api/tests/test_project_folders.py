"""Nested project folders via tag filtersets and derived tree."""

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.auth import Tenant
from app.models.project import Project
from app.services.platform_apply import apply_project_change
from app.services.projects import resolve_folder_ref


async def _auth_headers(client: AsyncClient) -> dict[str, str]:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert login.status_code == 200
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


async def _project(
    client: AsyncClient,
    headers: dict[str, str],
    name: str,
    slug: str,
    *,
    tags: list[str],
    parent_id: str | None = None,
) -> dict:
    body: dict = {"name": name, "slug": slug, "autonomous_scope": "ops", "tags": tags}
    response = await client.post("/api/folders", headers=headers, json=body)
    assert response.status_code == 200, response.text
    data = response.json()
    if parent_id:
        nested = await client.post(
            f"/api/folders/{data['id']}/nest",
            headers=headers,
            json={"onto_folder_id": parent_id},
        )
        assert nested.status_code == 200, nested.text
        data = nested.json()
    return data


@pytest.mark.asyncio
async def test_nested_folders_slug_cycle_and_thread_rollup(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    admin = await _project(client, headers, "Administratie", "administratie-folders", tags=["administratie"])
    invoices = await _project(
        client, headers, "Facturen", "facturen", tags=["facturen"], parent_id=admin["id"]
    )
    orders = await _project(client, headers, "Werkbonnen", "werkbonnen", tags=["werkbonnen"], parent_id=admin["id"])
    same_name = await _project(
        client, headers, "Facturen", "facturen-2", tags=["facturen"], parent_id=orders["id"]
    )
    assert set(same_name["tag_names"]) >= {"administratie", "werkbonnen", "facturen"}
    assert invoices["tag_names"][-1] == same_name["tag_names"][-1]

    clash = await client.post(
        "/api/folders",
        headers=headers,
        json={
            "name": "Facturen clash",
            "slug": "facturen",
            "autonomous_scope": "ops",
            "tags": ["facturen"],
        },
    )
    assert clash.status_code == 200

    detail = await client.get(f"/api/folders/{admin['id']}", headers=headers)
    assert detail.status_code == 200
    names = {child["name"].lower() for child in detail.json()["children"]}
    assert "facturen" in names and "werkbonnen" in names
    assert detail.json()["child_count"] >= 2

    listed = await client.get("/api/folders", headers=headers)
    assert listed.status_code == 200
    rows = listed.json()
    roots = [row for row in rows if "administratie" in row.get("tag_names", []) and len(row["tag_names"]) == 1]
    assert roots
    assert roots[0]["parent_id"] is None
    assert roots[0]["child_count"] >= 2

    ingest = await client.post(
        "/api/signals/inbound",
        headers=headers,
        json={
            "channel": "internal",
            "source": "mock",
            "subject": "Old invoice",
            "body_text": "File me",
        },
    )
    assert ingest.status_code == 200
    signal_id = ingest.json()["id"]
    filed = await client.patch(
        f"/api/signals/{signal_id}",
        headers=headers,
        json={"status": "closed", "project_id": invoices["id"]},
    )
    assert filed.status_code == 200
    assert filed.json()["project_id"] == invoices["id"]

    parent_list = await client.get(
        "/api/signals",
        headers=headers,
        params={"view": "closed", "project_id": admin["id"]},
    )
    assert parent_list.status_code == 200
    assert any(item["id"] == signal_id for item in parent_list.json()["items"])

    child_only = await client.get(
        "/api/signals",
        headers=headers,
        params={"view": "closed", "project_id": orders["id"]},
    )
    assert child_only.status_code == 200
    assert all(item["id"] != signal_id for item in child_only.json()["items"])

    removed = await client.request(
        "DELETE",
        f"/api/folders/{admin['id']}",
        headers=headers,
        json={"confirm_name": detail.json()["name"]},
    )
    assert removed.status_code == 200
    still = await client.get(f"/api/folders/{invoices['id']}", headers=headers)
    assert still.status_code == 200


@pytest.mark.asyncio
async def test_create_folder_parent_accepts_slug_and_rejects_ambiguous(
    client: AsyncClient, session_override
):
    """Govern apply: parent_id resolves slug when unique."""
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    from app.models.project import ProjectTagLink
    from app.models.signal import SignalTag
    from app.services.signal_tags import normalize_tag

    tag_y = normalize_tag("2025") or "2025"
    tag_row = SignalTag(tenant_id=tenant.id, name=tag_y)
    session_override.add(tag_row)
    await session_override.flush()
    year = Project(
        tenant_id=tenant.id,
        name="2025",
        slug="2025-folders-slug-parent",
        autonomous_scope="ops",
    )
    session_override.add(year)
    await session_override.flush()
    session_override.add(
        ProjectTagLink(project_id=year.id, tag_id=tag_row.id, tenant_id=tenant.id, sort_order=0)
    )

    tag_o = normalize_tag("stichting_soest_netwerkt") or "stichting"
    tag_o_row = SignalTag(tenant_id=tenant.id, name=tag_o)
    session_override.add(tag_o_row)
    await session_override.flush()
    org = Project(
        tenant_id=tenant.id,
        name="stichting_soest_netwerkt",
        slug="stichting_soest_netwerkt",
        autonomous_scope="ops",
    )
    session_override.add(org)
    await session_override.flush()
    session_override.add(
        ProjectTagLink(project_id=org.id, tag_id=tag_o_row.id, tenant_id=tenant.id, sort_order=0)
    )
    session_override.add(
        ProjectTagLink(project_id=org.id, tag_id=tag_row.id, tenant_id=tenant.id, sort_order=1)
    )
    await session_override.commit()
    await session_override.refresh(org)

    by_slug, err = await resolve_folder_ref(
        session_override, tenant.id, "stichting_soest_netwerkt"
    )
    assert err is None
    assert by_slug is not None and by_slug.id == org.id

    applied = await apply_project_change(
        session_override,
        tenant.id,
        "create",
        {
            "name": "aangiften",
            "slug": "aangiften",
            "parent_id": "stichting_soest_netwerkt",
            "autonomous_scope": "ops",
            "tags": ["aangiften"],
        },
        {},
    )
    assert applied.get("status") not in ("invalid", "error"), applied
    assert applied.get("id")

    twin = Project(
        tenant_id=tenant.id,
        name="stichting_soest_netwerkt",
        slug="stichting_soest_netwerkt-dup",
        autonomous_scope="ops",
    )
    session_override.add(twin)
    await session_override.commit()

    _row, amb_err = await resolve_folder_ref(
        session_override, tenant.id, "stichting_soest_netwerkt"
    )
    assert amb_err and "matches" in amb_err
    rejected = await apply_project_change(
        session_override,
        tenant.id,
        "create",
        {
            "name": "bonnetjes",
            "slug": "bonnetjes",
            "parent_id": "stichting_soest_netwerkt",
            "autonomous_scope": "ops",
            "tags": ["bonnetjes"],
        },
        {},
    )
    assert rejected.get("status") == "invalid"
    assert "matches" in str(rejected.get("error") or "")
