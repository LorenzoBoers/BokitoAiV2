"""Workbench callbacks and job listing."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Header, Request
from sqlalchemy import select

from bokito.api.schemas import RunOut
from bokito.deps import DbSession, Operator
from bokito.domain.connection import ConnectionKind
from bokito.domain.work import Run, RunKind
from bokito.errors import NotFound, Unauthorized
from bokito.services import connections as conn_svc
from bokito.services import workbench as wb_svc
from bokito.workbench import get_adapter

router = APIRouter(tags=["workbench"])


@router.post(
    "/hooks/workbench/{public_key}",
    summary="Workbench status callback (signed)",
    response_model=dict,
)
async def workbench_webhook(
    public_key: str,
    request: Request,
    session: DbSession,
    x_webhook_signature: str | None = Header(default=None),
    x_webhook_event: str | None = Header(default=None),
) -> dict[str, Any]:
    conn = await conn_svc.get_by_public_key(session, public_key)
    if not conn or conn.kind != ConnectionKind.workbench:
        raise NotFound("workbench not found", code="workbench_not_found")
    adapter = get_adapter(conn.provider)
    raw = await request.body()
    secret = str(conn_svc.credentials_of(conn).get("webhook_secret") or "")
    if not adapter.verify_webhook(secret, raw, x_webhook_signature or ""):
        raise Unauthorized("invalid webhook signature", code="invalid_signature")
    try:
        payload = await request.json()
    except Exception as exc:
        raise NotFound("payload is not JSON", code="invalid_payload") from exc
    if not isinstance(payload, dict):
        raise NotFound("payload is not an object", code="invalid_payload")
    event = adapter.parse_webhook(payload)
    run = await wb_svc.handle_event(session, conn, event)
    await session.commit()
    return {"ok": True, "run_id": str(run.id) if run else None, "event": x_webhook_event}


@router.get("/workbench/jobs", response_model=list[RunOut], summary="Workbench jobs")
async def list_jobs(session: DbSession, principal: Operator, limit: int = 50) -> list[RunOut]:
    rows = (
        await session.scalars(
            select(Run)
            .where(Run.tenant_id == principal.tenant_id, Run.kind == RunKind.job)
            .order_by(Run.created_at.desc())
            .limit(min(limit, 200))
        )
    ).all()
    return [RunOut.model_validate(r) for r in rows]


@router.post(
    "/workbench/jobs/{job_run_id}/refresh",
    response_model=RunOut,
    summary="Poll the provider for a job's status",
)
async def refresh_job(job_run_id: uuid.UUID, session: DbSession, principal: Operator) -> RunOut:
    from bokito.services import work as work_svc

    run = await work_svc.get_run(session, principal.tenant_id, job_run_id)
    conn_id = (run.checkpoint or {}).get("connection_id")
    if not conn_id:
        raise NotFound("job has no workbench connection", code="job_not_workbench")
    conn = await wb_svc.resolve_connection(session, principal.tenant_id, uuid.UUID(str(conn_id)))
    await wb_svc.refresh_status(session, conn, run)
    await session.commit()
    return RunOut.model_validate(run)
