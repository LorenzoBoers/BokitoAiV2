"""First-run onboarding wizard API."""

import pytest
from httpx import AsyncClient


async def _signup(client: AsyncClient, slug: str) -> dict:
    signup = await client.post(
        "/api/auth/signup",
        json={
            "email": f"{slug}@example.com",
            "password": "test-password",
            "tenant_slug": slug,
            "tenant_name": slug.title(),
        },
    )
    assert signup.status_code == 200, signup.text
    return {"Authorization": f"Bearer {signup.json()['access_token']}"}


@pytest.mark.asyncio
async def test_wizard_get_and_complete(client: AsyncClient):
    headers = await _signup(client, "wizard-co")

    got = await client.get("/api/app/onboarding/wizard", headers=headers)
    assert got.status_code == 200, got.text
    body = got.json()
    assert body["needs_wizard"] is True
    assert body["wizard_required"] is True
    assert body["wizard_completed_at"] is None
    assert body["lead_agent"] is not None
    assert body["scope"] == "owner"

    patched = await client.patch(
        "/api/app/onboarding/wizard",
        headers=headers,
        json={
            "intake": {"source": "search", "org_size": "2-10", "use_case": "inbox"},
            "ai_workspace_language": "en",
            "autonomy_posture": "manual",
        },
    )
    assert patched.status_code == 200, patched.text
    mid = patched.json()
    assert mid["intake"]["source"] == "search"
    assert mid["intake"]["org_size"] == "2-10"
    assert mid["ai_workspace_language"] == "en"
    assert mid["autonomy_posture"] == "manual"
    assert mid["needs_wizard"] is True

    done = await client.patch(
        "/api/app/onboarding/wizard",
        headers=headers,
        json={"complete": True},
    )
    assert done.status_code == 200, done.text
    final = done.json()
    assert final["needs_wizard"] is False
    assert final["wizard_completed_at"]
    assert final["wizard_required"] is False

    status = await client.get("/api/app/onboarding", headers=headers)
    steps = {s["id"]: s["done"] for s in status.json()["steps"]}
    assert steps["wizard"] is True
    assert steps["watching"] is False
