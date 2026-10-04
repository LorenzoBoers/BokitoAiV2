"""Workbench gateway: adapters (mocked HTTP), connections, ingest, job tokens."""

from __future__ import annotations

import hashlib
import hmac
import json
from unittest.mock import AsyncMock, patch

from httpx import AsyncClient
from sqlalchemy import select

from app.models.auth import Tenant, User
from app.models.integration import IntegrationConnection
from app.models.workbench import WorkJob
from app.services.crypto import set_connection_credentials
from app.services.workbench import Budget, JobSpec, NormalizedEvent, get_adapter
from app.services.workbench.capabilities import PHASE1_PROVIDERS, capability
from app.services.workbench.gateway import JobLinks, dispatch, ingest, refresh
from app.services.workbench.job_tokens import DEFAULT_JOB_TOOLS, mint_job_token
from scripts.seed import TEST_EMAIL, TEST_PASSWORD


async def _headers(client: AsyncClient) -> dict[str, str]:
    login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


async def test_phase1_adapters_registered():
    for provider in PHASE1_PROVIDERS:
        adapter = get_adapter(provider)
        assert adapter is not None
        assert adapter.capabilities().start is True
        assert capability(provider, "start") is True


async def test_cursor_start_and_webhook(client: AsyncClient, session_override):
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    user = (await session_override.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    conn = IntegrationConnection(
        tenant_id=tenant.id,
        kind="workbench",
        provider="cursor",
        display_name="Cursor",
        status="active",
        metadata_json="{}",
    )
    set_connection_credentials(conn, {"api_key": "test-cursor-key", "webhook_secret": "whsec"})
    session_override.add(conn)
    await session_override.commit()
    await session_override.refresh(conn)

    create_resp = {
        "agent": {
            "id": "bc-11111111-1111-1111-1111-111111111111",
            "url": "https://cursor.com/agents?id=bc-1",
        },
        "run": {"id": "run-1", "status": "CREATING"},
    }

    with patch(
        "app.services.workbench.cursor.request_json",
        new=AsyncMock(return_value=create_resp),
    ):
        job = await dispatch(
            session_override,
            tenant_id=tenant.id,
            spec=JobSpec(
                repo_url="https://github.com/acme/app",
                ref="main",
                brief="Add a health check",
                context_packet={},
                budget=Budget(max_minutes=30),
            ),
            connection_id=conn.id,
            links=JobLinks(signal_id=None),
            approved_by=user.id,
        )

    assert job.provider == "cursor"
    assert job.state == "running"
    assert job.external_id.startswith("bc-")
    assert job.job_token_id is not None

    payload = {
        "event": "statusChange",
        "timestamp": "2026-10-03T12:00:00Z",
        "id": job.external_id,
        "status": "FINISHED",
        "summary": "Done",
        "target": {
            "url": "https://cursor.com/agents?id=x",
            "branchName": "cursor/health",
            "prUrl": "https://github.com/acme/app/pull/9",
        },
    }
    raw = json.dumps(payload).encode()
    sig = "sha256=" + hmac.new(b"whsec", raw, hashlib.sha256).hexdigest()
    resp = await client.post(
        f"/api/workbench/cursor/webhook/{conn.id}",
        content=raw,
        headers={"Content-Type": "application/json", "X-Webhook-Signature": sig},
    )
    assert resp.status_code == 204

    job_id = job.id
    refreshed = (
        await session_override.execute(select(WorkJob).where(WorkJob.id == job_id))
    ).scalar_one()
    assert refreshed.state == "finished"
    arts = json.loads(refreshed.artifacts_json)
    assert any(a.get("type") == "pr" for a in arts)


async def test_devin_status_mapping_and_poll(client: AsyncClient, session_override):
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    user = (await session_override.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    conn = IntegrationConnection(
        tenant_id=tenant.id,
        kind="workbench",
        provider="devin",
        display_name="Devin",
        status="active",
        metadata_json=json.dumps({"org_id": "org-1"}),
    )
    set_connection_credentials(conn, {"api_key": "cog_test", "org_id": "org-1"})
    session_override.add(conn)
    await session_override.commit()
    await session_override.refresh(conn)

    create_resp = {
        "session_id": "devin-abc",
        "status": "new",
        "url": "https://app.devin.ai/sessions/devin-abc",
    }
    poll_resp = {
        "session_id": "devin-abc",
        "status": "running",
        "status_detail": "waiting_for_user",
        "title": "Need a choice",
        "updated_at": 1,
    }

    with patch(
        "app.services.workbench.devin.request_json",
        new=AsyncMock(side_effect=[create_resp, poll_resp]),
    ):
        job = await dispatch(
            session_override,
            tenant_id=tenant.id,
            spec=JobSpec(
                repo_url="https://github.com/acme/app",
                ref="main",
                brief="Fix login",
                context_packet={},
            ),
            connection_id=conn.id,
            links=JobLinks(),
            approved_by=user.id,
        )
        await refresh(session_override, job)

    job_id = job.id
    refreshed = (
        await session_override.execute(select(WorkJob).where(WorkJob.id == job_id))
    ).scalar_one()
    assert refreshed.state == "needs_input"


async def test_claude_managed_start_body(client: AsyncClient, session_override):
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    user = (await session_override.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    conn = IntegrationConnection(
        tenant_id=tenant.id,
        kind="workbench",
        provider="claude_managed",
        display_name="Claude",
        status="active",
        metadata_json="{}",
    )
    set_connection_credentials(conn, {"api_key": "sk-ant-test"})
    session_override.add(conn)
    await session_override.commit()
    await session_override.refresh(conn)

    calls: list[tuple[str, str, dict]] = []

    async def fake_request(method, url, **kwargs):
        calls.append((method, url, kwargs.get("json_body") or {}))
        if url.endswith("/agents"):
            return {"id": "agent_1"}
        if url.endswith("/environments"):
            return {"id": "env_1"}
        if url.endswith("/vaults"):
            return {"id": "vlt_1"}
        if "/vaults/" in url and url.endswith("/credentials"):
            return {"id": "cred_1"}
        if url.endswith("/sessions"):
            return {"id": "session_1", "status": "running"}
        return {}

    with patch("app.services.workbench.claude_managed.request_json", new=fake_request):
        job = await dispatch(
            session_override,
            tenant_id=tenant.id,
            spec=JobSpec(
                repo_url="https://github.com/acme/app",
                ref="main",
                brief="Refactor auth",
                context_packet={},
                budget=Budget(max_minutes=45, max_cost_cents=2500),
            ),
            connection_id=conn.id,
            links=JobLinks(),
            approved_by=user.id,
        )

    assert job.external_id == "session_1"
    assert any(c[1].endswith("/vaults") for c in calls)
    assert any("/vaults/vlt_1/credentials" in c[1] for c in calls)
    cred_call = next(c for c in calls if "/vaults/vlt_1/credentials" in c[1])
    assert cred_call[2]["auth"]["type"] == "static_bearer"
    assert "token" in cred_call[2]["auth"]
    session_call = next(c for c in calls if c[1].endswith("/sessions"))
    body = session_call[2]
    assert body["environment_id"] == "env_1"
    assert body["vault_ids"] == ["vlt_1"]
    assert body["budget"]["type"] == "limit"
    assert body["budget"]["max_list_cost"]["amount"] == "2500"
    assert body["agent"]["type"] == "agent_with_overrides"
    assert body["agent"]["mcp_servers"][0]["name"] == "bokito"
    assert "authorization_token" not in body["agent"]["mcp_servers"][0]
    env_call = next(c for c in calls if c[1].endswith("/environments"))
    assert env_call[2]["config"]["networking"]["allow_mcp_servers"] is True


async def test_job_token_allowlist(client: AsyncClient, session_override):
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    user = (await session_override.execute(select(User).where(User.email == TEST_EMAIL))).scalar_one()
    job = WorkJob(tenant_id=tenant.id, provider="cursor", state="running")
    session_override.add(job)
    await session_override.flush()
    token, plain = await mint_job_token(session_override, job, created_by_user_id=user.id)
    await session_override.commit()
    assert plain.startswith("bok_")
    allow = json.loads(token.tool_allowlist_json)
    for name in ("report_progress", "ask_question", "attach_artifact"):
        assert name in allow
    assert set(DEFAULT_JOB_TOOLS).issubset(set(allow))


async def test_ingest_idempotent(client: AsyncClient, session_override):
    tenant = (await session_override.execute(select(Tenant))).scalar_one()
    job = WorkJob(tenant_id=tenant.id, provider="cursor", state="running", external_id="bc-1")
    session_override.add(job)
    await session_override.commit()
    ev = NormalizedEvent(kind="progress", summary="step", external_event_id="e1")
    await ingest(session_override, job, [ev])
    await session_override.commit()
    await session_override.refresh(job)
    assert json.loads(job.seen_event_ids_json) == ["e1"]
    await ingest(session_override, job, [ev])
    await session_override.commit()
    await session_override.refresh(job)
    assert json.loads(job.seen_event_ids_json) == ["e1"]


async def test_connect_endpoint(client: AsyncClient, session_override):
    headers = await _headers(client)
    resp = await client.post(
        "/api/workbench/connections",
        headers=headers,
        json={"provider": "cursor", "api_key": "k-cursor"},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()["connection"]
    assert data["provider"] == "cursor"
    assert data["has_credentials"] is True

    listed = await client.get("/api/workbench/connections", headers=headers)
    assert listed.status_code == 200
    assert len(listed.json()["connections"]) == 1

    catalog = await client.get("/api/workbench/catalog", headers=headers)
    assert catalog.status_code == 200
    providers = {p["provider"] for p in catalog.json()["providers"]}
    assert {"cursor", "claude_managed", "devin"} <= providers
