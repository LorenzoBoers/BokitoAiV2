import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.auth import Tenant
from app.models.signal import Signal, SignalMessage
from app.services.interpretation import triage_signal
from app.services.platform_access import agent_has_scope, effective_scopes
from app.models.agent import Agent


async def _auth_headers(client: AsyncClient) -> dict[str, str]:
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


@pytest.mark.asyncio
async def test_signals_api_list_and_inbound(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    ingest = await client.post(
        "/api/signals/inbound",
        headers=headers,
        json={
            "channel": "email",
            "source": "mock",
            "subject": "Help needed",
            "body_text": "I need support with billing",
            "contact_email": "a@test.com",
        },
    )
    assert ingest.status_code == 200
    listed = await client.get("/api/signals?view=all_open", headers=headers)
    assert listed.status_code == 200
    assert len(listed.json()["items"]) >= 1


@pytest.mark.asyncio
async def test_triage_signal_mock_llm(client: AsyncClient, session_override):
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    from app.services.signals import create_inbound_signal

    signal = await create_inbound_signal(
        session_override,
        tenant.id,
        channel="email",
        source="mock",
        subject="Urgent invoice issue",
        body_text="Our invoice is wrong and we need this fixed today",
    )
    result = await triage_signal(session_override, tenant.id, signal.id)
    assert result.get("category")
    assert result.get("summary")
    row = (
        await session_override.execute(select(Signal).where(Signal.id == signal.id))
    ).scalar_one()
    assert row.triaged_at is not None


@pytest.mark.asyncio
async def test_email_connection_id_filter(client: AsyncClient, session_override):
    from app.models.auth import Tenant, user_numeric_id
    from app.models.channel import ChannelAccount

    headers = await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    account = (
        await session_override.execute(
            select(ChannelAccount).where(
                ChannelAccount.tenant_id == tenant.id, ChannelAccount.channel == "email"
            )
        )
    ).scalar_one()

    linked = await client.post(
        "/api/signals/inbound",
        headers=headers,
        json={
            "channel": "email",
            "source": "mock",
            "subject": "Mailbox scoped",
            "body_text": "Only this mailbox",
            "contact_email": "scoped@test.com",
        },
    )
    assert linked.status_code == 200

    numeric_id = user_numeric_id(account.id)
    filtered = await client.get(
        f"/api/signals?view=all_open&folder=external&email_connection_id={numeric_id}",
        headers=headers,
    )
    assert filtered.status_code == 200
    subjects = [item["email_subject"] for item in filtered.json()["items"]]
    assert "Mailbox scoped" in subjects

    other = await client.get(
        "/api/signals?view=all_open&folder=external&email_connection_id=999999999",
        headers=headers,
    )
    assert other.status_code == 200
    assert other.json()["itemsTotal"] == 0


@pytest.mark.asyncio
async def test_outbound_view(client: AsyncClient, session_override):
    from app.models.auth import Tenant

    headers = await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()

    sig = Signal(
        tenant_id=tenant.id,
        channel="email",
        subject="Outbound queue",
        status="open",
    )
    session_override.add(sig)
    await session_override.flush()
    session_override.add(
        SignalMessage(
            signal_id=sig.id,
            tenant_id=tenant.id,
            kind="agent_message",
            direction="outbound",
            body_text="We replied",
            body_preview="We replied",
        )
    )
    await session_override.commit()

    listed = await client.get("/api/signals?view=outbound&folder=external", headers=headers)
    assert listed.status_code == 200
    subjects = [item["email_subject"] for item in listed.json()["items"]]
    assert "Outbound queue" in subjects


@pytest.mark.asyncio
async def test_signals_sync_status(client: AsyncClient):
    headers = await _auth_headers(client)
    resp = await client.get("/api/signals/sync-status", headers=headers)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


@pytest.mark.asyncio
async def test_platform_access_role_defaults(client: AsyncClient, session_override):
    agent = (
        await session_override.execute(select(Agent).where(Agent.role == "assistant"))
    ).scalar_one()
    scopes = effective_scopes(agent)
    assert "platform:read" in scopes
    assert agent_has_scope(agent, "platform:doc:write")
    assert not agent_has_scope(agent, "platform:agent:create")


@pytest.mark.asyncio
async def test_widget_follow_up_reuses_open_thread(client: AsyncClient):
    headers = await _auth_headers(client)
    first = await client.post(
        "/api/signals/inbound",
        headers=headers,
        json={
            "channel": "widget",
            "source": "widget",
            "subject": "Bestelling",
            "body_text": "Waar blijft mijn pakket?",
            "contact_email": "lisa.merge@example.com",
            "contact_name": "Lisa Merge",
        },
    )
    assert first.status_code == 200, first.text
    first_id = first.json()["id"]
    follow = await client.post(
        "/api/signals/inbound",
        headers=headers,
        json={
            "channel": "widget",
            "source": "widget",
            "subject": "Bestelling",
            "body_text": "Heb je al een track-and-trace?",
            "contact_email": "lisa.merge@example.com",
            "contact_name": "Lisa Merge",
        },
    )
    assert follow.status_code == 200, follow.text
    assert follow.json()["id"] == first_id
    detail = await client.get(f"/api/signals/{first_id}", headers=headers)
    assert detail.status_code == 200
    bodies = [m.get("body_text") for m in detail.json()["messages"] if m.get("direction") == "inbound"]
    assert "Waar blijft mijn pakket?" in bodies
    assert "Heb je al een track-and-trace?" in bodies


@pytest.mark.asyncio
async def test_inbox_folder_excludes_internal(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    internal = Signal(
        tenant_id=tenant.id,
        channel="internal",
        subject="Platform check-in",
        status="open",
        has_unread=True,
    )
    session_override.add(internal)
    await session_override.commit()

    inbox = await client.get("/api/signals?view=all&folder=inbox", headers=headers)
    assert inbox.status_code == 200
    ids = {item["id"] for item in inbox.json()["items"]}
    assert str(internal.id) not in ids


@pytest.mark.asyncio
async def test_list_threads_and_flags(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    needs = Signal(
        tenant_id=tenant.id,
        channel="widget",
        subject="Needs reply",
        contact_email="needs.reply@example.com",
        contact_name="Needs Reply",
        status="open",
        has_unread=False,
    )
    done = Signal(
        tenant_id=tenant.id,
        channel="widget",
        subject="Already answered",
        contact_email="done.reply@example.com",
        contact_name="Done Reply",
        status="open",
        has_unread=False,
    )
    unread = Signal(
        tenant_id=tenant.id,
        channel="widget",
        subject="Unread inbound",
        contact_email="unread.flag@example.com",
        contact_name="Unread Flag",
        status="open",
        has_unread=True,
    )
    session_override.add_all([needs, done, unread])
    await session_override.flush()
    session_override.add(
        SignalMessage(
            signal_id=needs.id,
            tenant_id=tenant.id,
            kind="user_message",
            direction="inbound",
            body_text="Can you help?",
        )
    )
    session_override.add(
        SignalMessage(
            signal_id=needs.id,
            tenant_id=tenant.id,
            kind="agent_message",
            direction="outbound",
            body_text="I received your message about: Can you help? This is a placeholder reply while the workspace runs without a live model.",
        )
    )
    session_override.add(
        SignalMessage(
            signal_id=done.id,
            tenant_id=tenant.id,
            kind="user_message",
            direction="inbound",
            body_text="Old question",
        )
    )
    session_override.add(
        SignalMessage(
            signal_id=done.id,
            tenant_id=tenant.id,
            kind="user_message",
            direction="outbound",
            body_text="We already answered this.",
        )
    )
    session_override.add(
        SignalMessage(
            signal_id=unread.id,
            tenant_id=tenant.id,
            kind="user_message",
            direction="inbound",
            body_text="New inbound",
        )
    )
    await session_override.commit()

    unread_list = await client.get(
        "/api/signals?view=all_open&folder=inbox&unread=1",
        headers=headers,
    )
    assert unread_list.status_code == 200
    unread_ids = {item["id"] for item in unread_list.json()["items"]}
    assert str(unread.id) in unread_ids
    assert str(done.id) not in unread_ids

    needs_list = await client.get(
        "/api/signals?view=all_open&folder=inbox&needs_reply=1",
        headers=headers,
    )
    assert needs_list.status_code == 200
    needs_ids = {item["id"] for item in needs_list.json()["items"]}
    assert str(needs.id) in needs_ids
    assert str(unread.id) in needs_ids
    assert str(done.id) not in needs_ids


@pytest.mark.asyncio
async def test_thread_preview_skips_mock_agent(client: AsyncClient, session_override):
    headers = await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    signal = Signal(
        tenant_id=tenant.id,
        channel="widget",
        subject="Afspraak",
        contact_name="Mark Preview",
        contact_email="mark.preview@example.com",
        status="open",
        has_unread=True,
    )
    session_override.add(signal)
    await session_override.flush()
    session_override.add(
        SignalMessage(
            signal_id=signal.id,
            tenant_id=tenant.id,
            kind="user_message",
            direction="inbound",
            body_text="Kunnen jullie mijn afspraak verzetten?",
            body_preview="Kunnen jullie mijn afspraak verzetten?",
        )
    )
    session_override.add(
        SignalMessage(
            signal_id=signal.id,
            tenant_id=tenant.id,
            kind="agent_message",
            direction="outbound",
            body_text="[mock] I received your message about: afspraak. This is the Bokito AI OS assistant running in mock mode.",
            body_preview="[mock] I received your message about: afspraak.",
        )
    )
    await session_override.commit()

    listed = await client.get("/api/signals?view=all_open&folder=inbox", headers=headers)
    assert listed.status_code == 200
    row = next(item for item in listed.json()["items"] if item["id"] == str(signal.id))
    assert "[mock]" not in (row.get("last_message_preview") or "")
    assert "afspraak" in (row.get("last_message_preview") or "").lower()
    assert row.get("last_message_direction") == "inbound"


@pytest.mark.asyncio
async def test_human_reply_defers_suggested_reply(client: AsyncClient, session_override):
    from app.models.notification import DecisionRequest

    headers = await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    ingest = await client.post(
        "/api/signals/inbound",
        headers=headers,
        json={
            "channel": "widget",
            "source": "widget",
            "subject": "Factuur",
            "body_text": "Klopt dit bedrag?",
            "contact_email": "sanne.defer@example.com",
            "contact_name": "Sanne Defer",
        },
    )
    assert ingest.status_code == 200
    signal_id = ingest.json()["id"]
    decision = DecisionRequest(
        tenant_id=tenant.id,
        signal_id=__import__("uuid").UUID(signal_id),
        title="Suggested reply",
        summary="Ja, het bedrag klopt.",
        status="awaiting_human",
    )
    session_override.add(decision)
    await session_override.commit()

    reply = await client.post(
        f"/api/signals/{signal_id}/reply",
        headers=headers,
        json={"body_text": "Hoi Sanne, het bedrag klopt. Groet, Admin", "action": "send"},
    )
    assert reply.status_code == 200, reply.text

    refreshed = (
        await session_override.execute(select(DecisionRequest).where(DecisionRequest.id == decision.id))
    ).scalar_one()
    await session_override.refresh(refreshed)
    assert refreshed.status == "deferred"
    assert refreshed.chosen_option_id == "human_replied"


@pytest.mark.asyncio
async def test_snooze_defers_suggested_reply(client: AsyncClient, session_override):
    from app.models.notification import DecisionRequest

    headers = await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    ingest = await client.post(
        "/api/signals/inbound",
        headers=headers,
        json={
            "channel": "widget",
            "source": "widget",
            "subject": "Retour",
            "body_text": "Kan ik dit ruilen?",
            "contact_email": "tom.snooze@example.com",
            "contact_name": "Tom Snooze",
        },
    )
    assert ingest.status_code == 200
    signal_id = ingest.json()["id"]
    decision = DecisionRequest(
        tenant_id=tenant.id,
        signal_id=__import__("uuid").UUID(signal_id),
        title="Suggested reply",
        summary="Ja, ruilen kan.",
        status="awaiting_human",
    )
    session_override.add(decision)
    await session_override.commit()

    parked = await client.patch(
        f"/api/signals/{signal_id}",
        headers=headers,
        json={"status": "pending"},
    )
    assert parked.status_code == 200, parked.text

    refreshed = (
        await session_override.execute(select(DecisionRequest).where(DecisionRequest.id == decision.id))
    ).scalar_one()
    await session_override.refresh(refreshed)
    assert refreshed.status == "deferred"
    assert refreshed.chosen_option_id == "human_snoozed"


@pytest.mark.asyncio
async def test_defer_skips_non_reply_decisions(client: AsyncClient, session_override):
    from app.models.notification import DecisionRequest

    headers = await _auth_headers(client)
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    ingest = await client.post(
        "/api/signals/inbound",
        headers=headers,
        json={
            "channel": "widget",
            "source": "widget",
            "subject": "Scope defer",
            "body_text": "Kunnen jullie dit nakijken?",
            "contact_email": "scope.defer@example.com",
            "contact_name": "Scope Defer",
        },
    )
    assert ingest.status_code == 200
    signal_id = ingest.json()["id"]
    suggestion = DecisionRequest(
        tenant_id=tenant.id,
        signal_id=__import__("uuid").UUID(signal_id),
        title="Suggested reply",
        summary="Ja, we kijken het na.",
        status="awaiting_human",
    )
    other = DecisionRequest(
        tenant_id=tenant.id,
        signal_id=__import__("uuid").UUID(signal_id),
        title="Approve tool use",
        summary="May the agent create a task?",
        status="awaiting_human",
    )
    session_override.add(suggestion)
    session_override.add(other)
    await session_override.commit()

    reply = await client.post(
        f"/api/signals/{signal_id}/reply",
        headers=headers,
        json={"body_text": "Hoi, we kijken het na.", "action": "send"},
    )
    assert reply.status_code == 200, reply.text

    refreshed_suggestion = (
        await session_override.execute(select(DecisionRequest).where(DecisionRequest.id == suggestion.id))
    ).scalar_one()
    refreshed_other = (
        await session_override.execute(select(DecisionRequest).where(DecisionRequest.id == other.id))
    ).scalar_one()
    await session_override.refresh(refreshed_suggestion)
    await session_override.refresh(refreshed_other)
    assert refreshed_suggestion.status == "deferred"
    assert refreshed_other.status == "awaiting_human"


@pytest.mark.asyncio
async def test_internal_note_keeps_unread(client: AsyncClient):
    headers = await _auth_headers(client)
    ingest = await client.post(
        "/api/signals/inbound",
        headers=headers,
        json={
            "channel": "widget",
            "source": "widget",
            "subject": "Note unread",
            "body_text": "Klant wacht op antwoord",
            "contact_email": "note.unread@example.com",
            "contact_name": "Note Unread",
        },
    )
    assert ingest.status_code == 200
    signal_id = ingest.json()["id"]
    note = await client.post(
        f"/api/signals/{signal_id}/notes",
        headers=headers,
        json={"body_text": "Even intern afstemmen"},
    )
    assert note.status_code == 200, note.text
    listed = await client.get("/api/signals?view=all_open&folder=inbox", headers=headers)
    row = next(item for item in listed.json()["items"] if item["id"] == signal_id)
    assert row["has_unread"] is True
