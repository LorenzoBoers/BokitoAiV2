"""CRM companies: domain auto-link on contact creation + companies API."""

import pytest
from httpx import AsyncClient

from app.services.companies import business_domain, default_company_name
from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _headers(client: AsyncClient) -> dict[str, str]:
    r = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


# --- domain helpers ---------------------------------------------------------------


def test_business_domain_extraction():
    assert business_domain("jan@acme.com") == "acme.com"
    assert business_domain("Jan@ACME.com ") == "acme.com"
    assert business_domain("jan@gmail.com") == ""  # consumer provider
    assert business_domain("jan@hotmail.nl") == ""
    assert business_domain("lisa.de.vries@example.com") == ""
    assert business_domain("visitor_abc123") == ""  # widget visitor key
    assert business_domain("") == ""
    assert business_domain("broken@") == ""


def test_default_company_name():
    assert default_company_name("acme.com") == "Acme"
    assert default_company_name("bokito.ai") == "Bokito"


# --- auto-link on creation --------------------------------------------------------


@pytest.mark.asyncio
async def test_manual_contact_auto_links_company(client: AsyncClient):
    headers = await _headers(client)

    r = await client.post(
        "/api/channels/contacts",
        headers=headers,
        json={"channel": "email", "address": "anna@zebrasoft.io", "display_name": "Anna"},
    )
    assert r.status_code == 200, r.text
    contact = r.json()
    assert contact["company_id"]
    assert contact["company"] == "Zebrasoft"

    companies = await client.get("/api/channels/companies", headers=headers)
    rows = companies.json()["companies"]
    company = next(c for c in rows if c["domain"] == "zebrasoft.io")
    assert company["name"] == "Zebrasoft"
    assert company["contact_count"] == 1


@pytest.mark.asyncio
async def test_same_domain_contacts_share_company(client: AsyncClient):
    headers = await _headers(client)
    for addr in ("a@octoco.nl", "b@octoco.nl"):
        r = await client.post(
            "/api/channels/contacts",
            headers=headers,
            json={"channel": "email", "address": addr},
        )
        assert r.status_code == 200, r.text

    companies = await client.get("/api/channels/companies?search=octoco", headers=headers)
    rows = companies.json()["companies"]
    assert len(rows) == 1
    assert rows[0]["contact_count"] == 2


@pytest.mark.asyncio
async def test_consumer_domains_get_no_company(client: AsyncClient):
    headers = await _headers(client)
    r = await client.post(
        "/api/channels/contacts",
        headers=headers,
        json={"channel": "email", "address": "piet@gmail.com"},
    )
    assert r.status_code == 200
    assert r.json()["company_id"] is None


@pytest.mark.asyncio
async def test_inbound_signal_contact_links_company(client: AsyncClient):
    headers = await _headers(client)
    r = await client.post(
        "/api/signals/inbound",
        headers=headers,
        json={
            "subject": "Quote request",
            "body_text": "Hi, quote please",
            "contact_email": "sales@flamingo.dev",
        },
    )
    assert r.status_code == 200, r.text

    companies = await client.get("/api/channels/companies?search=flamingo", headers=headers)
    rows = companies.json()["companies"]
    assert len(rows) == 1
    assert rows[0]["domain"] == "flamingo.dev"


# --- company detail / update / delete ---------------------------------------------


@pytest.mark.asyncio
async def test_company_detail_and_update(client: AsyncClient):
    headers = await _headers(client)
    await client.post(
        "/api/channels/contacts",
        headers=headers,
        json={"channel": "email", "address": "kim@giraffe.co", "display_name": "Kim"},
    )
    await client.post(
        "/api/signals/inbound",
        headers=headers,
        json={"subject": "Hello", "body_text": "Hi", "contact_email": "kim@giraffe.co"},
    )

    companies = await client.get("/api/channels/companies?search=giraffe", headers=headers)
    company_id = companies.json()["companies"][0]["id"]

    detail = await client.get(f"/api/channels/companies/{company_id}", headers=headers)
    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert any(c["address"] == "kim@giraffe.co" for c in body["contacts"])
    assert body["threads"], "expected the inbound thread to appear on the company"
    assert any(t.get("email_subject") == "Hello" for t in body["threads"])

    updated = await client.patch(
        f"/api/channels/companies/{company_id}",
        headers=headers,
        json={"name": "Giraffe BV", "notes": "Key account"},
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "Giraffe BV"
    assert updated.json()["notes"] == "Key account"

    deleted = await client.delete(f"/api/channels/companies/{company_id}", headers=headers)
    assert deleted.status_code == 200
    # Contact survives, unlinked.
    contacts = await client.get("/api/channels/contacts?search=giraffe", headers=headers)
    row = next(c for c in contacts.json()["contacts"] if c["address"] == "kim@giraffe.co")
    assert row["company_id"] is None


@pytest.mark.asyncio
async def test_backfill_links_existing_contacts(client: AsyncClient, session_override):
    headers = await _headers(client)

    # Simulate a pre-existing contact created before company linking existed.
    from app.models.auth import Tenant
    from app.models.channel import Contact
    from sqlalchemy import select

    tenant = (
        (await session_override.execute(select(Tenant).where(Tenant.slug == "test")))
        .scalars()
        .one()
    )
    session_override.add(
        Contact(tenant_id=tenant.id, channel="email", address="old@legacyfirm.com")
    )
    await session_override.commit()

    r = await client.post("/api/channels/companies/backfill", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["linked"] >= 1

    companies = await client.get("/api/channels/companies?search=legacyfirm", headers=headers)
    assert len(companies.json()["companies"]) == 1
