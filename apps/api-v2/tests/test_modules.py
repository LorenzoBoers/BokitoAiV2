"""Module install seeds types, playbooks and skills; module tools are gated on install."""

from __future__ import annotations

from httpx import AsyncClient

from tests.conftest import auth


async def test_catalog_install_and_tool_gating(client: AsyncClient, owner: dict):
    r = await client.get("/api/modules", headers=auth(owner))
    assert r.status_code == 200
    mods = {m["slug"]: m for m in r.json()}
    assert "accounting" in mods
    assert mods["accounting"]["installed"] is False
    assert "moneybird_send_invoice" in mods["accounting"]["tools"]

    # Module tools are invisible and blocked before install.
    r = await client.get("/api/tools", headers=auth(owner))
    names = {t["name"] for t in r.json()}
    assert "moneybird_find_contact" not in names
    r = await client.post(
        "/api/tools/execute",
        json={"name": "moneybird_find_contact", "args": {"query": "example"}},
        headers=auth(owner),
    )
    assert r.status_code == 403 and r.json()["error"]["code"] == "module_not_installed"

    # A wrong connection kind is refused.
    r = await client.post(
        "/api/connections",
        json={
            "kind": "workbench",
            "provider": "cursor",
            "name": "Cursor",
            "credentials": {"api_key": "k"},
        },
        headers=auth(owner),
    )
    wrong = r.json()["id"]
    r = await client.post(
        "/api/modules/accounting/install", json={"connection_id": wrong}, headers=auth(owner)
    )
    assert r.status_code == 409

    r = await client.post(
        "/api/connections",
        json={
            "kind": "integration",
            "provider": "moneybird",
            "name": "Moneybird",
            "credentials": {"access_token": "mb_token", "administration_id": "123"},
        },
        headers=auth(owner),
    )
    assert r.status_code == 201, r.text
    conn_id = r.json()["id"]
    r = await client.post(f"/api/connections/{conn_id}/verify", headers=auth(owner))
    assert r.json()["status"] == "active"

    r = await client.post(
        "/api/modules/accounting/install",
        json={"connection_id": conn_id, "settings": {"reminder_days": 10}},
        headers=auth(owner),
    )
    assert r.status_code == 201, r.text
    out = r.json()
    assert out["installed"] is True
    assert out["created"] == {"signal_types": 2, "playbooks": 2, "docs": 1}
    assert out["install"]["settings"]["reminder_days"] == 10

    r = await client.post(
        "/api/modules/accounting/install", json={"connection_id": conn_id}, headers=auth(owner)
    )
    assert r.status_code == 409

    # Seeds are visible through the normal surfaces, tagged with the module.
    r = await client.get("/api/signals/types", headers=auth(owner))
    types = {t["slug"]: t for t in r.json()}
    assert types["invoice_question"]["module"] == "accounting"
    assert types["invoice_question"]["playbook_id"]
    r = await client.get("/api/playbooks", headers=auth(owner))
    pbs = {p["slug"]: p for p in r.json()}
    assert pbs["send_payment_reminder"]["module"] == "accounting"
    r = await client.get("/api/knowledge/docs", headers=auth(owner))
    assert any(d["path"] == "skills/accounting" for d in r.json())

    # Tools now list and run (mock Moneybird).
    r = await client.get("/api/tools", headers=auth(owner))
    names = {t["name"] for t in r.json()}
    assert {"moneybird_find_contact", "moneybird_list_invoices", "moneybird_send_invoice"} <= names

    r = await client.post(
        "/api/tools/execute",
        json={"name": "moneybird_find_contact", "args": {"query": "example.com"}},
        headers=auth(owner),
    )
    assert r.status_code == 200, r.text
    contacts = r.json()["result"]["contacts"]
    assert contacts and contacts[0]["name"] == "Example BV"

    r = await client.post(
        "/api/tools/execute",
        json={
            "name": "moneybird_list_invoices",
            "args": {"contact_id": contacts[0]["id"], "state": "open|late"},
        },
        headers=auth(owner),
    )
    invoices = r.json()["result"]["invoices"]
    assert len(invoices) == 1 and invoices[0]["state"] == "open"

    # Sending is consequential: an API client gets a decision first; the operator approves.
    r = await client.post(
        "/api/govern/tokens", json={"name": "bot", "scopes": []}, headers=auth(owner)
    )
    tok = r.json()["token"]
    r = await client.post(
        "/api/tools/execute",
        json={"name": "moneybird_send_invoice", "args": {"invoice_id": invoices[0]["id"]}},
        headers={"Authorization": f"Bearer {tok}"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "decision"
    decision_id = r.json()["decision_id"]
    r = await client.post(
        f"/api/decisions/{decision_id}/resolve", json={"option": "approve"}, headers=auth(owner)
    )
    assert r.status_code == 200, r.text
    assert r.json()["result"]["result"]["sent"] is True

    # A paid invoice is refused.
    r = await client.post(
        "/api/tools/execute",
        json={"name": "moneybird_send_invoice", "args": {"invoice_id": "2026-0031"}},
        headers=auth(owner),
    )
    assert r.status_code == 502 and r.json()["error"]["code"] == "moneybird_invoice_state"

    # Settings patch and uninstall (types disabled, playbooks inactive, tools gone).
    r = await client.patch(
        "/api/modules/accounting", json={"settings": {"reminder_days": 5}}, headers=auth(owner)
    )
    assert r.status_code == 200 and r.json()["install"]["settings"]["reminder_days"] == 5

    r = await client.delete("/api/modules/accounting", headers=auth(owner))
    assert r.status_code == 204
    r = await client.get("/api/modules/accounting", headers=auth(owner))
    assert r.json()["installed"] is False
    r = await client.get("/api/signals/types", headers=auth(owner))
    assert all(not t["enabled"] for t in r.json() if t["module"] == "accounting")
    r = await client.get("/api/playbooks", headers=auth(owner))
    assert all(not p["active"] for p in r.json() if p["module"] == "accounting")
    r = await client.get("/api/tools", headers=auth(owner))
    assert "moneybird_find_contact" not in {t["name"] for t in r.json()}

    # Reinstall is idempotent on seeds.
    r = await client.post(
        "/api/modules/accounting/install", json={"connection_id": conn_id}, headers=auth(owner)
    )
    assert r.status_code == 201
    assert r.json()["created"] == {"signal_types": 0, "playbooks": 0, "docs": 0}
    r = await client.get("/api/signals/types", headers=auth(owner))
    assert all(t["enabled"] for t in r.json() if t["module"] == "accounting")
