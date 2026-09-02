"""Tests for credentials encryption and privacy/retention helpers."""

from datetime import datetime, timedelta
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth import Tenant
from app.models.calendar import CalendarEvent
from app.models.channel import Contact
from app.models.integration import IntegrationConnection
from app.models.signal import Signal, SignalMessage
from app.services.crypto import (
    decrypt_credentials_blob,
    encrypt_credentials_blob,
    get_connection_credentials,
    is_encrypted_credentials,
    set_connection_credentials,
)
from app.services.privacy import (
    erase_subject,
    export_subject,
    merge_privacy_settings,
    purge_expired_for_tenant,
    scrub_pii_text,
)
from scripts.seed import TEST_EMAIL, TEST_PASSWORD


def test_credentials_roundtrip_and_legacy():
    blob = encrypt_credentials_blob({"access_token": "tok", "mock": False})
    assert is_encrypted_credentials(blob)
    assert decrypt_credentials_blob(blob)["access_token"] == "tok"
    legacy = decrypt_credentials_blob('{"access_token": "plain"}')
    assert legacy["access_token"] == "plain"


def test_scrub_pii_text():
    out = scrub_pii_text("Call me at +31 6 12345678 or a@b.nl please")
    assert "[email]" in out
    assert "[phone]" in out
    assert "a@b.nl" not in out


@pytest.mark.asyncio
async def test_set_connection_credentials_encrypts(session_override: AsyncSession):
    tenant = Tenant(slug=f"priv-{uuid4().hex[:8]}", name="Privacy Encrypt")
    session_override.add(tenant)
    await session_override.commit()
    await session_override.refresh(tenant)
    conn = IntegrationConnection(
        tenant_id=tenant.id,
        provider="google_calendar",
        display_name="Cal",
        status="active",
        credentials_json="{}",
    )
    session_override.add(conn)
    await session_override.commit()
    await session_override.refresh(conn)
    set_connection_credentials(conn, {"access_token": "secret", "mock": True})
    session_override.add(conn)
    await session_override.commit()
    await session_override.refresh(conn)
    assert is_encrypted_credentials(conn.credentials_json)
    assert get_connection_credentials(conn)["access_token"] == "secret"


@pytest.mark.asyncio
async def test_privacy_export_erase_and_retention(session_override: AsyncSession):
    tenant = Tenant(
        slug=f"priv-{uuid4().hex[:8]}",
        name="Privacy DSAR",
        settings_json='{"privacy": {"retention_messages_days": 365, "retention_calendar_days": 365}}',
    )
    session_override.add(tenant)
    await session_override.commit()
    await session_override.refresh(tenant)
    email = f"subject-{uuid4().hex[:6]}@example.com"
    contact = Contact(
        tenant_id=tenant.id,
        channel="email",
        address=email,
        display_name="Subject",
    )
    session_override.add(contact)
    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        subject="Hello",
        contact_email=email,
    )
    session_override.add(signal)
    await session_override.commit()
    await session_override.refresh(signal)
    msg = SignalMessage(
        signal_id=signal.id,
        tenant_id=tenant.id,
        direction="inbound",
        from_address=email,
        body_text="Secret body",
        created_at=datetime.utcnow() - timedelta(days=400),
    )
    session_override.add(msg)
    conn = IntegrationConnection(
        tenant_id=tenant.id,
        provider="google_calendar",
        display_name="G",
        status="active",
        credentials_json='{"mock": true}',
    )
    session_override.add(conn)
    await session_override.commit()
    await session_override.refresh(conn)
    ev = CalendarEvent(
        tenant_id=tenant.id,
        connection_id=conn.id,
        provider="google_calendar",
        external_id=f"e-{uuid4().hex[:8]}",
        title="Meet",
        attendees_json=f'["{email}"]',
        start_at=datetime.utcnow() - timedelta(days=400),
        end_at=datetime.utcnow() - timedelta(days=400) + timedelta(hours=1),
    )
    session_override.add(ev)
    await session_override.commit()

    package = await export_subject(
        session_override, tenant.id, email=email, actor_user_id=None
    )
    assert package["subject_email"] == email.lower()
    assert len(package["contacts"]) >= 1

    erased = await erase_subject(
        session_override, tenant.id, email=email, actor_user_id=None
    )
    assert erased["contacts"] >= 1

    merge_privacy_settings(
        tenant,
        {"retention_messages_days": 30, "retention_calendar_days": 30},
    )
    session_override.add(tenant)
    await session_override.commit()
    purged = await purge_expired_for_tenant(session_override, tenant)
    assert purged["messages_deleted"] >= 0


@pytest.mark.asyncio
async def test_privacy_api(client: AsyncClient):
    login = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    assert login.status_code == 200
    token = login.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    res = await client.get("/api/privacy/settings", headers=headers)
    assert res.status_code == 200
    assert "retention_messages_days" in res.json()["settings"]
    patch = await client.patch(
        "/api/privacy/settings",
        headers=headers,
        json={"llm_may_use_message_bodies": False, "retention_messages_days": 180},
    )
    assert patch.status_code == 200
    assert patch.json()["settings"]["llm_may_use_message_bodies"] is False
    assert patch.json()["settings"]["retention_messages_days"] == 180
