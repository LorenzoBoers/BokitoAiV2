"""Tests for custom database (app API group)."""

import pytest
from httpx import AsyncClient

from scripts.seed import TEST_EMAIL, TEST_PASSWORD

API = "/api/app"


async def _login(client: AsyncClient) -> str:
    res = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert res.status_code == 200
    return res.json()["access_token"]


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_standard_tables_bootstrap(client: AsyncClient):
    token = await _login(client)
    headers = _auth(token)
    created = await client.post(f"{API}/standard-tables/create", headers=headers)
    assert created.status_code == 200
    tables = created.json()
    assert len(tables) >= 3
    slugs = {t["slug"] for t in tables}
    assert "klanten" in slugs
    assert all(t["is_standard"] for t in tables)

    listed = await client.get(f"{API}/standard-tables", headers=headers)
    assert listed.status_code == 200
    assert len(listed.json()) >= 3


@pytest.mark.asyncio
async def test_custom_table_crud_and_records(client: AsyncClient):
    token = await _login(client)
    headers = _auth(token)

    table = await client.post(
        f"{API}/custom-tables",
        headers=headers,
        json={"name": "Leads", "description": "Sales leads", "color": "#6366f1"},
    )
    assert table.status_code == 200
    table_id = table.json()["id"]

    field = await client.post(
        f"{API}/custom-tables/{table_id}/fields",
        headers=headers,
        json={"name": "Company", "field_type": "text", "required": True},
    )
    assert field.status_code == 200

    record = await client.post(
        f"{API}/custom-tables/{table_id}/records",
        headers=headers,
        json={"data": {"Company": "Acme BV"}},
    )
    assert record.status_code == 200
    record_id = record.json()["id"]

    listed = await client.get(
        f"{API}/custom-tables/{table_id}/records",
        headers=headers,
        params={"page": 1, "per_page": 10},
    )
    assert listed.status_code == 200
    assert listed.json()["itemsTotal"] >= 1

    views = await client.get(f"{API}/custom-tables/{table_id}/views", headers=headers)
    assert views.status_code == 200
    assert len(views.json()) >= 1

    patched = await client.patch(
        f"{API}/custom-records/{record_id}",
        headers=headers,
        json={"data": {"Company": "Acme BV Updated"}},
    )
    assert patched.status_code == 200
    assert patched.json()["data"]["Company"] == "Acme BV Updated"
