"""Cursor workbench adapter: dispatch from a conversation, webhook lands the result."""

from __future__ import annotations

import hashlib
import hmac
import json

from httpx import AsyncClient

from tests.conftest import auth


async def test_dispatch_and_webhook(client: AsyncClient, owner: dict, session):
    r = await client.post(
        "/api/connections",
        json={
            "kind": "workbench",
            "provider": "cursor",
            "name": "Cursor",
            "credentials": {"api_key": "key_test"},
        },
        headers=auth(owner),
    )
    assert r.status_code == 201, r.text
    conn = r.json()
    assert conn["status"] == "pending"
    r = await client.post(f"/api/connections/{conn['id']}/verify", headers=auth(owner))
    assert r.status_code == 200 and r.json()["status"] == "active"

    r = await client.post(
        "/api/conversations",
        json={"subject": "Widget shows wrong totals", "channel": "email"},
        headers=auth(owner),
    )
    conv_id = r.json()["id"]

    # An operator dispatches directly; agents and API clients go through policy.
    r = await client.post(
        "/api/tools/execute",
        json={
            "name": "dispatch_work",
            "args": {
                "brief": "Fix the rounding bug in the totals column of the orders widget.",
                "repository": "https://github.com/acme/widget",
                "ref": "main",
                "conversation_id": conv_id,
            },
        },
        headers=auth(owner),
    )
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["status"] == "done"
    assert out["result"]["provider"] == "cursor"

    r = await client.get("/api/workbench/jobs", headers=auth(owner))
    jobs = r.json()
    assert len(jobs) == 1
    job = jobs[0]
    assert job["id"] == out["result"]["job_run_id"]
    assert job["kind"] == "job" and job["status"] == "running"
    external_id = job["checkpoint"]["external_id"]
    assert external_id.startswith("bc_mock_")
    assert job["checkpoint"]["url"].startswith("https://cursor.com/agents?id=")

    r = await client.get(f"/api/conversations/{conv_id}/messages", headers=auth(owner))
    bodies = [m["body"] for m in r.json()["items"]]
    assert any(b.startswith("Handed to Cursor") for b in bodies)

    # Provider calls back. Signature over the raw body with the connection's webhook secret.
    from bokito.domain.connection import Connection
    from bokito.services import connections as conn_svc

    row = await session.get(Connection, conn["id"])
    secret = conn_svc.credentials_of(row)["webhook_secret"]
    assert row.public_key
    payload = {
        "event": "statusChange",
        "timestamp": "2026-09-30T10:00:00Z",
        "id": external_id,
        "status": "FINISHED",
        "source": {"repository": "https://github.com/acme/widget", "ref": "main"},
        "target": {
            "url": f"https://cursor.com/agents?id={external_id}",
            "branchName": "cursor/fix-rounding",
            "prUrl": "https://github.com/acme/widget/pull/42",
        },
        "summary": "Rounded totals with Decimal quantize.",
    }
    body = json.dumps(payload).encode()

    bad = await client.post(
        f"/api/hooks/workbench/{row.public_key}",
        content=body,
        headers={"Content-Type": "application/json", "X-Webhook-Signature": "sha256=deadbeef"},
    )
    assert bad.status_code == 401

    sig = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    ok = await client.post(
        f"/api/hooks/workbench/{row.public_key}",
        content=body,
        headers={
            "Content-Type": "application/json",
            "X-Webhook-Signature": sig,
            "X-Webhook-Event": "statusChange",
        },
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["run_id"] == job["id"]

    r = await client.get(f"/api/runs/{job['id']}", headers=auth(owner))
    run = r.json()
    assert run["status"] == "done"
    assert run["output"]["pr_url"] == "https://github.com/acme/widget/pull/42"

    r = await client.get(f"/api/conversations/{conv_id}/messages", headers=auth(owner))
    bodies = [m["body"] for m in r.json()["items"]]
    assert any("Pull request: https://github.com/acme/widget/pull/42" in b for b in bodies)

    # Status tool and refresh endpoint work on the closed job too.
    r = await client.post(
        "/api/tools/execute",
        json={"name": "workbench_status", "args": {"job_run_id": job["id"]}},
        headers=auth(owner),
    )
    assert r.status_code == 200 and r.json()["result"]["run_status"] == "done"
