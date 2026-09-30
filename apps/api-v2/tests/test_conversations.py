"""Conversation flow through the REST mirror of the tools."""

from __future__ import annotations

from httpx import AsyncClient

from tests.conftest import auth


async def _start(client: AsyncClient, owner: dict, subject: str = "Question") -> dict:
    r = await client.post(
        "/api/conversations",
        json={"subject": subject, "body": "Hello, what are your opening hours?", "tags": ["Sales"]},
        headers=auth(owner),
    )
    assert r.status_code == 201, r.text
    return r.json()


async def test_list_thread_reply_and_status(client: AsyncClient, owner: dict) -> None:
    conv = await _start(client, owner)
    assert conv["channel"] == "internal"
    assert conv["tags"] == ["sales"]

    r = await client.get("/api/conversations", headers=auth(owner))
    assert r.status_code == 200
    body = r.json()
    assert [c["id"] for c in body["items"]] == [conv["id"]]
    assert body["counts"]["all"] == 1

    r = await client.post(
        f"/api/conversations/{conv['id']}/reply",
        json={"body": "We are open 9 to 5."},
        headers=auth(owner),
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "done"

    r = await client.post(
        f"/api/conversations/{conv['id']}/notes", json={"body": "VIP"}, headers=auth(owner)
    )
    assert r.status_code == 200

    r = await client.get(f"/api/conversations/{conv['id']}/messages", headers=auth(owner))
    kinds = [m["kind"] for m in r.json()["items"]]
    assert kinds == ["message", "message", "note"]
    reply = r.json()["items"][1]
    assert reply["direction"] == "outbound"
    assert reply["send_status"] == "sent"
    assert reply["ai_generated"] is False

    r = await client.post(
        f"/api/conversations/{conv['id']}/status", json={"status": "closed"}, headers=auth(owner)
    )
    assert r.status_code == 200
    assert r.json()["status"] == "closed"
    assert r.json()["closed_at"] is not None

    r = await client.get("/api/conversations", headers=auth(owner))
    assert r.json()["items"] == []
    r = await client.get("/api/conversations?status=closed", headers=auth(owner))
    assert len(r.json()["items"]) == 1


async def test_tenant_isolation(client: AsyncClient, owner: dict) -> None:
    conv = await _start(client, owner)
    from tests.conftest import signup

    other = await signup(client, email="other@example.com", workspace="Other")
    r = await client.get(f"/api/conversations/{conv['id']}", headers=auth(other))
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "conversation_not_found"
    r = await client.get("/api/conversations", headers=auth(other))
    assert r.json()["items"] == []


async def test_search_and_queue_filters(client: AsyncClient, owner: dict) -> None:
    a = await _start(client, owner, subject="Invoice 1234")
    await _start(client, owner, subject="Delivery")
    r = await client.get("/api/conversations", params={"q": "invoice"}, headers=auth(owner))
    assert [c["id"] for c in r.json()["items"]] == [a["id"]]

    r = await client.post(
        f"/api/conversations/{a['id']}/assign",
        json={"user_id": owner["user_id"]},
        headers=auth(owner),
    )
    assert r.status_code == 200, r.text
    r = await client.get("/api/conversations", params={"queue": "mine"}, headers=auth(owner))
    assert [c["id"] for c in r.json()["items"]] == [a["id"]]
    assert r.json()["counts"]["mine"] == 1
