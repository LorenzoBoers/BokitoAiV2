"""Mint and revoke short-lived MCP tokens bound to one WorkJob."""

from __future__ import annotations

import json
import secrets
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.api_token import ApiToken
from app.models.workbench import WorkJob
from app.services.audit import record_audit

DEFAULT_JOB_TOOLS = [
    "report_progress",
    "ask_question",
    "attach_artifact",
    "search_index",
    "search_repo",
    "get_project_canvas",
    "list_queue_items",
    "read_doc",
]


def hash_token(plain: str) -> str:
    from app.routers.govern import hash_token as _hash

    return _hash(plain)


async def mint_job_token(
    session: AsyncSession,
    job: WorkJob,
    *,
    created_by_user_id: UUID | None,
    max_minutes: int = 60,
    extra_tools: list[str] | None = None,
) -> tuple[ApiToken, str]:
    """Create an ApiToken for this job. Returns (row, plaintext) — plaintext shown once."""
    lifetime = min(max(max_minutes + 30, 60), 12 * 60)
    expires = datetime.utcnow() + timedelta(minutes=lifetime)
    allowlist = list(dict.fromkeys([*(extra_tools or []), *DEFAULT_JOB_TOOLS]))
    plain = f"bok_{secrets.token_urlsafe(32)}"
    token = ApiToken(
        tenant_id=job.tenant_id,
        name=f"workbench-job-{str(job.id)[:8]}",
        token_hash=hash_token(plain),
        token_prefix=plain[:10],
        scopes_json="[]",
        created_by_user_id=created_by_user_id,
        job_id=job.id,
        expires_at=expires,
        tool_allowlist_json=json.dumps(allowlist),
    )
    session.add(token)
    await session.flush()
    job.job_token_id = token.id
    session.add(job)
    await record_audit(
        session,
        job.tenant_id,
        action="workbench.job_token_minted",
        actor_type="system",
        actor_id="workbench",
        resource_type="work_job",
        resource_id=str(job.id),
        payload={"provider": job.provider, "token_id": str(token.id)},
        commit=False,
    )
    return token, plain


async def revoke_job_token(session: AsyncSession, job: WorkJob) -> None:
    if not job.job_token_id:
        return
    token = await session.get(ApiToken, job.job_token_id)
    if token is None or token.revoked_at is not None:
        return
    token.revoked_at = datetime.utcnow()
    session.add(token)
    await record_audit(
        session,
        job.tenant_id,
        action="workbench.job_token_revoked",
        actor_type="system",
        actor_id="workbench",
        resource_type="work_job",
        resource_id=str(job.id),
        payload={"token_id": str(token.id)},
        commit=False,
    )


def token_allowlist(token: ApiToken) -> list[str]:
    try:
        data = json.loads(token.tool_allowlist_json or "[]")
        return [str(x) for x in data] if isinstance(data, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


def job_token_is_valid(token: ApiToken) -> bool:
    if token.revoked_at is not None:
        return False
    if token.expires_at and token.expires_at < datetime.utcnow():
        return False
    return token.job_id is not None
