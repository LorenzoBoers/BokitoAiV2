"""The custom table builder is retired from the core API.

Contact, Project, and typed signal fields replace it. The router is no longer
mounted, so every path it used to serve answers 404.
"""

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
async def test_custom_table_endpoints_are_unmounted(client: AsyncClient):
    headers = _auth(await _login(client))

    assert (await client.get(f"{API}/standard-tables", headers=headers)).status_code == 404
    assert (await client.post(f"{API}/standard-tables/create", headers=headers)).status_code == 404
    assert (await client.get(f"{API}/custom-tables", headers=headers)).status_code == 404

    created = await client.post(
        f"{API}/custom-tables",
        headers=headers,
        json={"name": "Leads", "description": "Sales leads", "color": "#6366f1"},
    )
    assert created.status_code == 404
