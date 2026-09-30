"""Workbench jobs: dispatch a brief from a conversation, land the result back in it.

A job is a `Run(kind=job)` whose `checkpoint` carries the provider handle. The
provider calls our webhook when it finishes; we close the run and append a
`run` message to the originating conversation (the thread is the log).
"""

from __future__ import annotations

import secrets
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from bokito.config import get_settings
from bokito.deps import Principal
from bokito.domain.base import utcnow
from bokito.domain.connection import Connection, ConnectionKind
from bokito.domain.conversation import Conversation, Direction, MessageKind
from bokito.domain.work import Run, RunKind, RunStatus
from bokito.errors import NotFound
from bokito.services import connections as conn_svc
from bokito.services import conversation as conv_svc
from bokito.services import decision as decision_svc
from bokito.services import work as work_svc
from bokito.workbench import JobEvent, JobHandle, JobSpec, WorkbenchError, get_adapter


def ensure_webhook_secret(conn: Connection) -> str:
    creds = conn_svc.credentials_of(conn)
    secret = str(creds.get("webhook_secret") or "")
    if len(secret) < 32:
        secret = secrets.token_urlsafe(32)
        conn_svc.set_credentials(conn, {"webhook_secret": secret})
    return secret


def webhook_url(conn: Connection) -> str:
    s = get_settings()
    return f"{s.public_api_url.rstrip('/')}{s.api_prefix}/hooks/workbench/{conn.public_key}"


async def resolve_connection(
    session: AsyncSession, tenant_id: uuid.UUID, connection_id: uuid.UUID | None
) -> Connection:
    if connection_id:
        conn = await conn_svc.get(session, tenant_id, connection_id)
        if conn.kind != ConnectionKind.workbench:
            raise NotFound("connection is not a workbench", code="connection_not_workbench")
        return conn
    conn = await conn_svc.first_active(session, tenant_id, ConnectionKind.workbench)
    if not conn:
        raise WorkbenchError(
            "no active workbench connection; add Cursor cloud agents under Connections",
            code="workbench_missing",
        )
    return conn


async def dispatch(
    session: AsyncSession,
    principal: Principal,
    *,
    conn: Connection,
    brief: str,
    repository: str,
    ref: str = "",
    auto_pr: bool = True,
    branch_name: str = "",
    model: str = "",
    conversation_id: uuid.UUID | None = None,
    parent_run_id: uuid.UUID | None = None,
) -> tuple[Run, JobHandle]:
    adapter = get_adapter(conn.provider)
    secret = ensure_webhook_secret(conn)
    if not conn.public_key:
        conn.public_key = secrets.token_urlsafe(18)
    context: dict[str, Any] = {}
    if conversation_id:
        conv = await conv_svc.get(session, principal.tenant_id, conversation_id)
        context["conversation"] = {"id": str(conv.id), "subject": conv.subject}
    prompt = brief
    if context.get("conversation", {}).get("subject"):
        prompt = f"{brief}\n\nContext: this work was requested from the conversation " + (
            f'"{context["conversation"]["subject"]}" in Bokito.'
        )
    spec = JobSpec(
        brief=prompt,
        repository=repository,
        ref=ref,
        auto_pr=auto_pr,
        branch_name=branch_name,
        model=model,
        webhook_url=webhook_url(conn),
        webhook_secret=secret,
        context=context,
    )
    run = await work_svc.create_run(
        session,
        principal.tenant_id,
        kind=RunKind.job,
        title=f"{conn.provider}: {brief[:80]}",
        actor=principal.actor,
        trust=principal.trust,
        conversation_id=conversation_id,
        agent_id=principal.agent_id,
        parent_run_id=parent_run_id,
        input={
            "brief": brief,
            "repository": repository,
            "ref": ref,
            "auto_pr": auto_pr,
            "branch_name": branch_name,
            "connection_id": str(conn.id),
        },
    )
    try:
        handle = await adapter.launch(conn_svc.credentials_of(conn), spec)
    except WorkbenchError as exc:
        await work_svc.finish_run(session, run, status=RunStatus.failed, error=exc.message)
        raise
    run.status = RunStatus.running
    run.started_at = utcnow()
    run.checkpoint = {**handle.to_dict(), "connection_id": str(conn.id)}
    await conn_svc.touch(session, conn)
    if conversation_id:
        conv = await session.get(Conversation, conversation_id)
        if conv:
            body = f"Handed to {conn.name}: {brief[:200]}"
            if handle.url:
                body += f"\n{handle.url}"
            await conv_svc.append_message(
                session,
                conv,
                kind=MessageKind.run,
                direction=Direction.internal,
                body=body,
                author_label=conn.name,
                run_id=run.id,
                meta={"workbench": handle.to_dict()},
            )
    await session.flush()
    return run, handle


async def find_job(session: AsyncSession, conn: Connection, external_id: str) -> Run | None:
    stmt = (
        select(Run)
        .where(
            Run.tenant_id == conn.tenant_id,
            Run.kind == RunKind.job,
            Run.checkpoint["external_id"].astext == external_id,
        )
        .order_by(Run.created_at.desc())
        .limit(1)
    )
    return await session.scalar(stmt)


async def refresh_status(session: AsyncSession, conn: Connection, run: Run) -> JobHandle:
    adapter = get_adapter(conn.provider)
    ext = str((run.checkpoint or {}).get("external_id") or "")
    handle = await adapter.status(conn_svc.credentials_of(conn), ext)
    run.checkpoint = {**(run.checkpoint or {}), **handle.to_dict()}
    if handle.status == "finished" and run.status in (RunStatus.running, RunStatus.queued):
        await _close(
            session,
            conn,
            run,
            JobEvent(
                "cursor",
                ext,
                "finished",
                url=handle.url,
                branch_name=handle.branch_name,
                pr_url=handle.pr_url,
                summary=str(handle.raw.get("summary") or ""),
            ),
        )
    elif handle.status == "failed" and run.status in (RunStatus.running, RunStatus.queued):
        await _close(session, conn, run, JobEvent("cursor", ext, "failed", url=handle.url))
    await session.flush()
    return handle


async def followup(session: AsyncSession, conn: Connection, run: Run, text: str) -> JobHandle:
    adapter = get_adapter(conn.provider)
    ext = str((run.checkpoint or {}).get("external_id") or "")
    handle = await adapter.followup(conn_svc.credentials_of(conn), ext, text)
    run.step += 1
    if run.status in (RunStatus.done, RunStatus.failed, RunStatus.cancelled):
        run.status = RunStatus.running
        run.finished_at = None
    await session.flush()
    return handle


async def handle_event(session: AsyncSession, conn: Connection, event: JobEvent) -> Run | None:
    run = await find_job(session, conn, event.external_id)
    if not run:
        return None
    run.checkpoint = {
        **(run.checkpoint or {}),
        "status": event.kind,
        "url": event.url or (run.checkpoint or {}).get("url", ""),
        "branch_name": event.branch_name or (run.checkpoint or {}).get("branch_name", ""),
        "pr_url": event.pr_url or (run.checkpoint or {}).get("pr_url", ""),
    }
    if event.kind in ("finished", "failed"):
        await _close(session, conn, run, event)
    await session.flush()
    return run


async def _close(session: AsyncSession, conn: Connection, run: Run, event: JobEvent) -> None:
    output = {
        "summary": event.summary,
        "url": event.url or (run.checkpoint or {}).get("url", ""),
        "branch_name": event.branch_name or (run.checkpoint or {}).get("branch_name", ""),
        "pr_url": event.pr_url or (run.checkpoint or {}).get("pr_url", ""),
        "provider": conn.provider,
    }
    status = RunStatus.done if event.kind == "finished" else RunStatus.failed
    await work_svc.finish_run(
        session,
        run,
        status=status,
        output=output,
        error="" if event.kind == "finished" else (event.summary or "workbench job failed"),
    )
    conv = None
    if run.conversation_id:
        conv = await session.get(Conversation, run.conversation_id)
    if conv is None:
        conv = await decision_svc.govern_conversation(session, run.tenant_id)
    if event.kind == "finished":
        body = f"{conn.name} finished: {event.summary or run.title}"
        if output["pr_url"]:
            body += f"\nPull request: {output['pr_url']}"
        elif output["branch_name"]:
            body += f"\nBranch: {output['branch_name']}"
    else:
        body = f"{conn.name} failed: {event.summary or 'see the run for details'}"
    if output["url"]:
        body += f"\n{output['url']}"
    await conv_svc.append_message(
        session,
        conv,
        kind=MessageKind.run,
        direction=Direction.internal,
        body=body,
        author_label=conn.name,
        run_id=run.id,
        meta={"workbench": output},
    )
