"""WorkbenchGateway — only entry point that calls provider adapters."""

from __future__ import annotations

import json
import secrets
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.integration import IntegrationConnection
from app.models.usage import UsageLedger
from app.models.workbench import WorkJob
from app.services.audit import record_audit
from app.services.crypto import get_connection_credentials
from app.services.workbench import Budget, JobHandle, JobSpec, McpAttach, NormalizedEvent, get_adapter
from app.services.workbench.capabilities import PHASE1_PROVIDERS, capability
from app.services.workbench.http_util import WorkbenchHttpError
from app.services.workbench.job_tokens import mint_job_token, revoke_job_token
from app.services.workbench.publisher import publish_events

TERMINAL = frozenset({"finished", "failed", "cancelled"})


@dataclass
class JobLinks:
    signal_id: UUID | None = None
    case_id: UUID | None = None
    project_id: UUID | None = None
    agent_id: UUID | None = None
    decision_id: UUID | None = None


def _parse_json(raw: str | None, default: Any) -> Any:
    try:
        return json.loads(raw or "") if raw else default
    except (json.JSONDecodeError, TypeError):
        return default


def _handle_from_job(job: WorkJob) -> JobHandle:
    ids = _parse_json(job.external_ids_json, {})
    if not isinstance(ids, dict):
        ids = {}
    return JobHandle(
        provider=job.provider,
        external_id=job.external_id or str(ids.get("session_id") or ids.get("agent_id") or ""),
        external_ids={str(k): str(v) for k, v in ids.items()},
    )


async def _load_connection(
    session: AsyncSession, tenant_id: UUID, connection_id: UUID
) -> IntegrationConnection:
    conn = (
        await session.execute(
            select(IntegrationConnection).where(
                IntegrationConnection.id == connection_id,
                IntegrationConnection.tenant_id == tenant_id,
                IntegrationConnection.kind == "workbench",
            )
        )
    ).scalar_one_or_none()
    if conn is None:
        raise WorkbenchHttpError("Workbench connection not found")
    if conn.status != "active":
        raise WorkbenchHttpError("Workbench connection is not active")
    return conn


async def dispatch(
    session: AsyncSession,
    *,
    tenant_id: UUID,
    spec: JobSpec,
    connection_id: UUID,
    links: JobLinks,
    approved_by: UUID | None,
) -> WorkJob:
    conn = await _load_connection(session, tenant_id, connection_id)
    provider = conn.provider
    if provider not in PHASE1_PROVIDERS:
        raise WorkbenchHttpError(f"Provider {provider} is not connectable yet")
    adapter = get_adapter(provider)
    if adapter is None:
        raise WorkbenchHttpError(f"No adapter for provider={provider}")

    creds = get_connection_credentials(conn)
    meta = _parse_json(conn.metadata_json, {})
    if not isinstance(meta, dict):
        meta = {}
    # Merge non-secret metadata the adapters expect (org_id, agent_id, …).
    for key in ("org_id", "organization_id", "agent_id", "environment_id", "default_model", "create_as_user_id"):
        if meta.get(key) and key not in creds:
            creds[key] = meta[key]

    allowed = meta.get("allowed_repos") or []
    if isinstance(allowed, list) and allowed:
        if spec.repo_url.rstrip("/") not in {str(u).rstrip("/") for u in allowed}:
            raise WorkbenchHttpError("Repository is not on this connection's allowlist")

    budget = spec.budget or Budget()
    job = WorkJob(
        tenant_id=tenant_id,
        signal_id=links.signal_id,
        case_id=links.case_id,
        project_id=links.project_id,
        workbench_connection_id=conn.id,
        agent_id=links.agent_id,
        provider=provider,
        state="queued",
        summary=(spec.brief or "")[:500],
        brief_json=json.dumps(
            {
                "brief": spec.brief,
                "repo_url": spec.repo_url,
                "ref": spec.ref,
                "model": spec.model,
                "mode": spec.mode,
                "create_pr": spec.create_pr,
                "context_packet": {
                    k: v
                    for k, v in (spec.context_packet or {}).items()
                    if k not in ("secrets",)
                },
                "options": spec.options,
            }
        ),
        budget_json=json.dumps(asdict(budget)),
        decision_id=links.decision_id,
        requested_by_user_id=approved_by,
    )
    session.add(job)
    await session.flush()

    # Mint job token before start so MCP can be attached.
    plain_token = ""
    if capability(provider, "mcp_attach_per_job"):
        _, plain_token = await mint_job_token(
            session,
            job,
            created_by_user_id=approved_by,
            max_minutes=budget.max_minutes,
        )
        settings = get_settings()
        mcp_url = f"{settings.public_api_url.rstrip('/')}/api/mcp"
        spec.mcp = McpAttach(url=mcp_url, token=plain_token, tools=list(spec.mcp.tools if spec.mcp else []))
        if not spec.mcp.tools:
            from app.services.workbench.job_tokens import DEFAULT_JOB_TOOLS

            spec.mcp.tools = list(DEFAULT_JOB_TOOLS)

    # Webhook URL for Cursor.
    webhook_secret = str(creds.get("webhook_secret") or "")
    if not webhook_secret and capability(provider, "webhook"):
        webhook_secret = secrets.token_urlsafe(24)
        creds["webhook_secret"] = webhook_secret
        from app.services.crypto import set_connection_credentials

        set_connection_credentials(conn, creds)
        session.add(conn)

    if capability(provider, "webhook") and webhook_secret:
        settings = get_settings()
        spec.webhook_url = (
            f"{settings.public_api_url.rstrip('/')}/api/workbench/{provider}/webhook/{conn.id}"
        )
        spec.webhook_secret = webhook_secret

    spec.client_job_id = str(job.id)
    packet = dict(spec.context_packet or {})
    packet["job_ref"] = str(job.id)
    spec.context_packet = packet

    try:
        handle = await adapter.start(spec, creds)
    except Exception as exc:
        job.state = "failed"
        job.summary = f"Failed to start: {exc}"[:500]
        job.finished_at = datetime.utcnow()
        job.updated_at = datetime.utcnow()
        session.add(job)
        await revoke_job_token(session, job)
        await publish_events(
            session,
            job,
            [NormalizedEvent(kind="failed", summary=job.summary, external_event_id=f"start-fail:{job.id}")],
        )
        await session.commit()
        raise

    job.external_id = handle.external_id or handle.external_ids.get("agent_id") or handle.external_ids.get("session_id")
    job.external_ids_json = json.dumps(handle.external_ids)
    job.state = "running"
    job.last_event_at = datetime.utcnow()
    job.updated_at = datetime.utcnow()
    session.add(job)
    await publish_events(
        session,
        job,
        [
            NormalizedEvent(
                kind="started",
                summary=f"Started in {provider}",
                external_event_id=f"started:{job.id}",
                payload={"url": handle.external_ids.get("url")},
            )
        ],
    )
    await record_audit(
        session,
        tenant_id,
        action="workbench.dispatch",
        actor_type="user" if approved_by else "agent",
        actor_id=str(approved_by or links.agent_id or ""),
        resource_type="work_job",
        resource_id=str(job.id),
        payload={"provider": provider, "external_id": job.external_id},
        commit=False,
    )
    await session.commit()
    await session.refresh(job)
    return job


async def follow_up(
    session: AsyncSession,
    job: WorkJob,
    text: str,
    *,
    actor: UUID | None,
    images: list[dict[str, Any]] | None = None,
) -> None:
    if job.state in TERMINAL:
        raise WorkbenchHttpError("Job is already finished")
    if not capability(job.provider, "follow_up"):
        raise WorkbenchHttpError("This provider cannot take follow-ups")
    adapter = get_adapter(job.provider)
    if adapter is None or not job.workbench_connection_id:
        raise WorkbenchHttpError("Adapter or connection missing")
    conn = await _load_connection(session, job.tenant_id, job.workbench_connection_id)
    creds = get_connection_credentials(conn)
    meta = _parse_json(conn.metadata_json, {})
    if isinstance(meta, dict):
        for key in ("org_id", "organization_id", "agent_id", "environment_id"):
            if meta.get(key) and key not in creds:
                creds[key] = meta[key]
    handle = _handle_from_job(job)
    await adapter.follow_up(handle, text, creds, images=images)
    job.external_ids_json = json.dumps(handle.external_ids)
    job.state = "running"
    job.last_event_at = datetime.utcnow()
    job.updated_at = datetime.utcnow()
    session.add(job)
    await publish_events(
        session,
        job,
        [
            NormalizedEvent(
                kind="progress",
                summary="Follow-up sent",
                external_event_id=f"follow-up:{job.id}:{datetime.utcnow().isoformat()}",
            )
        ],
    )
    await record_audit(
        session,
        job.tenant_id,
        action="workbench.follow_up",
        actor_type="user" if actor else "system",
        actor_id=str(actor or ""),
        resource_type="work_job",
        resource_id=str(job.id),
        commit=False,
    )
    await session.commit()


async def cancel(
    session: AsyncSession,
    job: WorkJob,
    *,
    actor: UUID | None,
) -> None:
    if job.state in TERMINAL:
        return
    if not capability(job.provider, "cancel"):
        raise WorkbenchHttpError("This provider cannot cancel jobs")
    adapter = get_adapter(job.provider)
    if adapter is None or not job.workbench_connection_id:
        raise WorkbenchHttpError("Adapter or connection missing")
    conn = await _load_connection(session, job.tenant_id, job.workbench_connection_id)
    creds = get_connection_credentials(conn)
    meta = _parse_json(conn.metadata_json, {})
    if isinstance(meta, dict) and meta.get("org_id") and "org_id" not in creds:
        creds["org_id"] = meta["org_id"]
    handle = _handle_from_job(job)
    try:
        await adapter.cancel(handle, creds)
    except WorkbenchHttpError:
        # Still mark cancelled locally if the provider already ended.
        pass
    await ingest(
        session,
        job,
        [
            NormalizedEvent(
                kind="cancelled",
                summary="Cancelled by operator",
                external_event_id=f"cancel:{job.id}:{datetime.utcnow().isoformat()}",
            )
        ],
    )
    await record_audit(
        session,
        job.tenant_id,
        action="workbench.cancel",
        actor_type="user" if actor else "system",
        actor_id=str(actor or ""),
        resource_type="work_job",
        resource_id=str(job.id),
        commit=False,
    )
    await session.commit()


async def ingest(
    session: AsyncSession,
    job: WorkJob,
    events: list[NormalizedEvent],
) -> None:
    """Apply events to the ledger. Idempotent on external_event_id."""
    if not events:
        return
    seen = _parse_json(job.seen_event_ids_json, [])
    if not isinstance(seen, list):
        seen = []
    seen_set = {str(x) for x in seen}
    artifacts = _parse_json(job.artifacts_json, [])
    if not isinstance(artifacts, list):
        artifacts = []

    applied: list[NormalizedEvent] = []
    for event in events:
        eid = event.external_event_id or ""
        if eid and eid in seen_set:
            continue
        if eid:
            seen_set.add(eid)
            seen.append(eid)
        if event.kind == "artifact":
            art = (event.payload or {}).get("artifact")
            if isinstance(art, dict):
                artifacts = _upsert_artifact(artifacts, art)
                if job.project_id:
                    await _link_project_artifact(session, job, art)
        elif event.kind in TERMINAL:
            job.state = event.kind
            job.finished_at = datetime.utcnow()
            if event.summary:
                job.summary = event.summary[:500]
            if event.kind in ("failed", "cancelled") and not job.outcome:
                job.outcome = "abandoned"
        elif event.kind == "needs_input":
            if job.state not in TERMINAL:
                job.state = "needs_input"
        elif event.kind in ("started", "progress"):
            if job.state not in TERMINAL and job.state != "needs_input":
                job.state = "running"
            # Cost from payload when providers report it.
            usage = (event.payload or {}).get("usage") or {}
            if isinstance(usage, dict) and usage.get("cost_cents") is not None:
                try:
                    job.cost_cents = max(job.cost_cents, int(usage["cost_cents"]))
                except (TypeError, ValueError):
                    pass
            acus = (event.payload or {}).get("acus_consumed")
            if acus is not None:
                try:
                    # Store ACU * 100 as cents for a rough Overview signal.
                    job.cost_cents = max(job.cost_cents, int(float(acus) * 100))
                except (TypeError, ValueError):
                    pass
        applied.append(event)

    if not applied:
        return

    job.artifacts_json = json.dumps(artifacts)
    job.seen_event_ids_json = json.dumps(seen[-200:])
    job.last_event_at = datetime.utcnow()
    job.updated_at = datetime.utcnow()
    session.add(job)

    await publish_events(session, job, applied)

    if job.state in TERMINAL:
        await revoke_job_token(session, job)
        if job.cost_cents:
            session.add(
                UsageLedger(
                    tenant_id=job.tenant_id,
                    scope="workbench",
                    scope_id=str(job.id),
                    call_type="workbench",
                    provider=job.provider,
                    key_source="tenant",
                    cost_cents=job.cost_cents,
                    customer_cost_micros=job.cost_cents * 10_000,
                    agent_id=job.agent_id,
                    user_id=job.requested_by_user_id,
                )
            )


def _upsert_artifact(artifacts: list[Any], art: dict[str, Any]) -> list[Any]:
    external_id = str(art.get("external_id") or art.get("url") or "")
    now = datetime.utcnow().isoformat() + "Z"
    art = {**art, "created_at": art.get("created_at") or now}
    if external_id:
        for i, existing in enumerate(artifacts):
            if isinstance(existing, dict) and str(existing.get("external_id") or existing.get("url")) == external_id:
                merged = {**existing, **art}
                artifacts[i] = merged
                return artifacts
    artifacts.append(art)
    return artifacts


async def refresh(session: AsyncSession, job: WorkJob) -> None:
    if job.state in TERMINAL:
        return
    adapter = get_adapter(job.provider)
    if adapter is None or not job.workbench_connection_id:
        return
    conn = await _load_connection(session, job.tenant_id, job.workbench_connection_id)
    creds = get_connection_credentials(conn)
    meta = _parse_json(conn.metadata_json, {})
    if isinstance(meta, dict):
        for key in ("org_id", "organization_id", "agent_id", "environment_id"):
            if meta.get(key) and key not in creds:
                creds[key] = meta[key]
    handle = _handle_from_job(job)
    try:
        events = await adapter.poll(handle, creds)
    except WorkbenchHttpError as exc:
        job.last_polled_at = datetime.utcnow()
        session.add(job)
        # Lost contact after budget + 30 min.
        budget = _parse_json(job.budget_json, {})
        max_minutes = int(budget.get("max_minutes") or 60) if isinstance(budget, dict) else 60
        if job.last_event_at and job.last_event_at < datetime.utcnow() - timedelta(minutes=max_minutes + 30):
            await ingest(
                session,
                job,
                [
                    NormalizedEvent(
                        kind="failed",
                        summary=f"Lost contact with provider ({exc})",
                        external_event_id=f"lost:{job.id}",
                    )
                ],
            )
        await session.commit()
        return

    job.external_ids_json = json.dumps(handle.external_ids)
    job.last_polled_at = datetime.utcnow()
    session.add(job)
    await ingest(session, job, events)
    await session.commit()


async def _link_project_artifact(
    session: AsyncSession, job: WorkJob, art: dict[str, Any]
) -> None:
    """Attach PR/branch artifacts to the project as ProjectResource rows (no commit)."""
    if not job.project_id:
        return
    from app.models.project_work import ProjectResource

    url = str(art.get("url") or "")
    ref = str(art.get("ref") or "")
    title = str(art.get("title") or art.get("type") or "Workbench artifact")
    external = str(art.get("external_id") or url or ref)
    if not external:
        return
    existing = (
        await session.execute(
            select(ProjectResource).where(
                ProjectResource.tenant_id == job.tenant_id,
                ProjectResource.project_id == job.project_id,
            )
        )
    ).scalars().all()
    for row in existing:
        try:
            cfg = json.loads(row.config_json or "{}")
        except (json.JSONDecodeError, TypeError):
            cfg = {}
        if not isinstance(cfg, dict):
            cfg = {}
        if cfg.get("work_job_id") == str(job.id) and (
            row.external_ref == external or cfg.get("url") == url
        ):
            return
    resource = ProjectResource(
        tenant_id=job.tenant_id,
        project_id=job.project_id,
        resource_type="repo",
        provider=job.provider,
        connection_id=job.workbench_connection_id,
        label=title[:200],
        external_ref=external[:500],
        config_json=json.dumps(
            {
                "work_job_id": str(job.id),
                "url": url,
                "ref": ref,
                "artifact_type": art.get("type"),
                "state": art.get("state"),
            }
        ),
        status="connected" if job.workbench_connection_id else "linked",
    )
    session.add(resource)
    await _ensure_work_jobs_widget(session, job.tenant_id, job.project_id)


async def _ensure_work_jobs_widget(session: AsyncSession, tenant_id: UUID, project_id: UUID) -> None:
    """Add a live work_jobs widget when the canvas already exists (no create/commit)."""
    from app.models.project_canvas import ProjectCanvas
    from app.services import project_canvas as canvas_svc

    canvas = (
        await session.execute(
            select(ProjectCanvas).where(
                ProjectCanvas.tenant_id == tenant_id,
                ProjectCanvas.project_id == project_id,
                ProjectCanvas.slug == "main",
            )
        )
    ).scalar_one_or_none()
    if canvas is None:
        return
    widgets = canvas_svc.normalize_widgets(canvas_svc._parse_json(canvas.widgets_json, []))
    if any(isinstance(w, dict) and w.get("type") == "work_jobs" for w in widgets):
        return
    widgets.append(
        {
            "id": "work-jobs",
            "type": "work_jobs",
            "title": "Workbench jobs",
            "x": 0,
            "y": 12,
            "w": 12,
            "h": 3,
            "config": {},
        }
    )
    canvas.widgets_json = json.dumps(widgets)
    canvas.updated_at = datetime.utcnow()
    canvas.updated_by_type = "system"
    canvas.updated_by_id = "workbench"
    session.add(canvas)


async def poll_active_jobs(session: AsyncSession) -> int:
    """Cron entry: refresh jobs that need polling."""
    now = datetime.utcnow()
    result = await session.execute(
        select(WorkJob).where(WorkJob.state.in_(("queued", "running", "needs_input")))
    )
    jobs = list(result.scalars().all())
    count = 0
    for job in jobs:
        # Backoff: skip if polled recently.
        if job.last_polled_at and job.last_polled_at > now - timedelta(seconds=30):
            continue
        # Providers with reliable webhooks can skip unless stale (5 min).
        if capability(job.provider, "webhook") and job.last_event_at and job.last_event_at > now - timedelta(minutes=5):
            continue
        try:
            await refresh(session, job)
            count += 1
        except Exception:
            await session.rollback()
            continue
    return count
