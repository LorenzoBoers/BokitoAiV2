"""Workbench connections, jobs, and provider webhooks."""

from __future__ import annotations

import json
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.models.workbench import WorkJob
from app.services.crypto import get_connection_credentials
from app.services.workbench import NormalizedEvent, get_adapter
from app.services.workbench.connections import (
    catalog,
    delete_connection,
    list_connections,
    serialize_connection,
    upsert_connection,
)
from app.services.workbench.gateway import cancel as gw_cancel
from app.services.workbench.gateway import follow_up as gw_follow_up
from app.services.workbench.gateway import ingest
from app.services.workbench.gateway import refresh as gw_refresh
from app.services.workbench.http_util import WorkbenchHttpError

router = APIRouter(prefix="/workbench", tags=["workbench"])


class ConnectBody(BaseModel):
    provider: Literal["cursor", "claude_managed", "devin"]
    api_key: str = Field(min_length=1)
    display_name: str = ""
    org_id: str | None = None
    default_model: str | None = None
    git_token: str | None = None
    allowed_repos: list[str] | None = None


class FollowUpBody(BaseModel):
    text: str = Field(min_length=1)
    images: list[dict[str, Any]] | None = None


def _http_error(exc: WorkbenchHttpError) -> HTTPException:
    return HTTPException(status_code=400, detail=str(exc))


@router.get("/catalog")
async def get_catalog(auth: Annotated[AuthContext, Depends(get_current_auth)]) -> dict[str, Any]:
    """List workbench providers and their capabilities."""
    del auth
    return {"providers": catalog()}


@router.get("/connections")
async def get_connections(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict[str, Any]:
    rows = await list_connections(session, auth.tenant.id)
    return {"connections": rows}


@router.post("/connections")
async def post_connection(
    body: ConnectBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict[str, Any]:
    """Connect a phase-1 workbench provider with the tenant's own API key."""
    meta: dict[str, Any] = {}
    if body.org_id:
        meta["org_id"] = body.org_id
    if body.default_model:
        meta["default_model"] = body.default_model
    if body.allowed_repos is not None:
        meta["allowed_repos"] = body.allowed_repos
    try:
        conn = await upsert_connection(
            session,
            auth.tenant.id,
            provider=body.provider,
            api_key=body.api_key,
            display_name=body.display_name,
            metadata=meta,
            git_token=body.git_token,
        )
    except WorkbenchHttpError as exc:
        raise _http_error(exc) from exc
    return {"connection": serialize_connection(conn)}


@router.delete("/connections/{connection_id}")
async def remove_connection(
    connection_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict[str, str]:
    try:
        await delete_connection(session, auth.tenant.id, connection_id)
    except WorkbenchHttpError as exc:
        raise _http_error(exc) from exc
    return {"status": "revoked"}


def _serialize_job(job: WorkJob) -> dict[str, Any]:
    return {
        "id": str(job.id),
        "provider": job.provider,
        "state": job.state,
        "external_id": job.external_id,
        "external_ids": json.loads(job.external_ids_json or "{}"),
        "summary": job.summary,
        "artifacts": json.loads(job.artifacts_json or "[]"),
        "cost_cents": job.cost_cents,
        "outcome": job.outcome,
        "signal_id": str(job.signal_id) if job.signal_id else None,
        "project_id": str(job.project_id) if job.project_id else None,
        "connection_id": str(job.workbench_connection_id) if job.workbench_connection_id else None,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "finished_at": job.finished_at.isoformat() if job.finished_at else None,
    }


@router.get("/jobs")
async def list_jobs(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    signal_id: UUID | None = None,
    project_id: UUID | None = None,
) -> dict[str, Any]:
    q = select(WorkJob).where(WorkJob.tenant_id == auth.tenant.id)
    if signal_id:
        q = q.where(WorkJob.signal_id == signal_id)
    if project_id:
        q = q.where(WorkJob.project_id == project_id)
    q = q.order_by(WorkJob.created_at.desc()).limit(100)
    rows = (await session.execute(q)).scalars().all()
    return {"jobs": [_serialize_job(j) for j in rows]}


@router.get("/jobs/{job_id}")
async def get_job(
    job_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict[str, Any]:
    job = (
        await session.execute(
            select(WorkJob).where(WorkJob.id == job_id, WorkJob.tenant_id == auth.tenant.id)
        )
    ).scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"job": _serialize_job(job)}


@router.post("/jobs/{job_id}/follow-up")
async def post_follow_up(
    job_id: UUID,
    body: FollowUpBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict[str, Any]:
    job = (
        await session.execute(
            select(WorkJob).where(WorkJob.id == job_id, WorkJob.tenant_id == auth.tenant.id)
        )
    ).scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    try:
        await gw_follow_up(session, job, body.text, actor=auth.user.id, images=body.images)
    except WorkbenchHttpError as exc:
        raise _http_error(exc) from exc
    await session.refresh(job)
    return {"job": _serialize_job(job)}


@router.post("/jobs/{job_id}/cancel")
async def post_cancel(
    job_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict[str, Any]:
    job = (
        await session.execute(
            select(WorkJob).where(WorkJob.id == job_id, WorkJob.tenant_id == auth.tenant.id)
        )
    ).scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    try:
        await gw_cancel(session, job, actor=auth.user.id)
    except WorkbenchHttpError as exc:
        raise _http_error(exc) from exc
    await session.refresh(job)
    return {"job": _serialize_job(job)}


@router.post("/jobs/{job_id}/refresh")
async def post_refresh(
    job_id: UUID,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> dict[str, Any]:
    job = (
        await session.execute(
            select(WorkJob).where(WorkJob.id == job_id, WorkJob.tenant_id == auth.tenant.id)
        )
    ).scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    await gw_refresh(session, job)
    await session.refresh(job)
    return {"job": _serialize_job(job)}


@router.post("/{provider}/webhook/{connection_id}")
async def provider_webhook(
    provider: str,
    connection_id: UUID,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
    x_webhook_signature: Annotated[str | None, Header()] = None,
    x_webhook_id: Annotated[str | None, Header()] = None,
) -> Response:
    """Inbound provider webhook. Signature verified by the adapter."""
    from app.models.integration import IntegrationConnection

    raw = await request.body()
    conn = (
        await session.execute(
            select(IntegrationConnection).where(
                IntegrationConnection.id == connection_id,
                IntegrationConnection.kind == "workbench",
                IntegrationConnection.provider == provider,
            )
        )
    ).scalar_one_or_none()
    if conn is None:
        raise HTTPException(status_code=404, detail="Unknown connection")
    adapter = get_adapter(provider)
    if adapter is None:
        raise HTTPException(status_code=404, detail="Unknown provider")
    creds = get_connection_credentials(conn)
    secret = str(creds.get("webhook_secret") or "")
    headers = {k.lower(): v for k, v in request.headers.items()}
    if x_webhook_signature:
        headers["x-webhook-signature"] = x_webhook_signature
    if not adapter.verify_webhook(headers, raw, secret):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")
    try:
        payload = json.loads(raw.decode() or "{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid payload")

    events = await adapter.handle_webhook(payload)
    # Find the job by external agent/session id.
    external_id = str(
        payload.get("id")
        or payload.get("session_id")
        or (payload.get("agent") or {}).get("id")
        or ""
    )
    if not external_id and events:
        external_id = str((events[0].payload or {}).get("agent_id") or "")
    job = None
    if external_id:
        job = (
            await session.execute(
                select(WorkJob).where(
                    WorkJob.tenant_id == conn.tenant_id,
                    WorkJob.provider == provider,
                    WorkJob.external_id == external_id,
                )
            )
        ).scalar_one_or_none()
    if job is None:
        # Accept delivery so the provider does not retry forever.
        return Response(status_code=204)

    # Tag webhook delivery id for idempotency.
    if x_webhook_id:
        tagged: list[NormalizedEvent] = []
        for ev in events:
            tagged.append(
                NormalizedEvent(
                    kind=ev.kind,
                    summary=ev.summary,
                    payload=ev.payload,
                    external_event_id=ev.external_event_id or f"wh:{x_webhook_id}:{ev.kind}",
                )
            )
        events = tagged
    await ingest(session, job, events)
    await session.commit()
    return Response(status_code=204)
