"""LEARNING endpoints."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session
from app.dependencies import AuthContext, get_current_auth
from app.services.learning import (
    apply_heuristic_guardrails,
    compute_eval_scores,
    process_feedback_batch,
    serialize_eval,
    submit_feedback,
)

router = APIRouter(prefix="/learning", tags=["learning"])


class FeedbackBody(BaseModel):
    subject_type: str = "message"
    subject_id: str
    score: int | None = Field(default=None, ge=1, le=5)
    sentiment: str | None = None
    comment: str = ""
    correction_key: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)


@router.post("/feedback")
async def create_feedback(
    body: FeedbackBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    row = await submit_feedback(
        session,
        auth.tenant.id,
        subject_type=body.subject_type,
        subject_id=body.subject_id,
        user_id=auth.user.id,
        score=body.score,
        sentiment=body.sentiment,
        comment=body.comment,
        correction_key=body.correction_key,
        metadata=body.metadata,
    )
    return {"id": str(row.id), "processed": row.processed}


class ModulePackageBody(BaseModel):
    slug: str
    name: str
    manifest: dict[str, Any] = Field(default_factory=dict)


@router.post("/modules/save")
async def save_as_module(
    body: ModulePackageBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Pragmatic module package: versioned manifest stored as internal knowledge."""
    import json
    import re

    from app.services.workspace import get_doc_by_path, upsert_doc

    auth.require_role("owner", "admin")
    slug = re.sub(r"[^a-z0-9-]+", "-", body.slug.lower()).strip("-")
    if not slug:
        raise HTTPException(status_code=400, detail="slug is required")
    path = f"modules/{slug}.md"
    existing = await get_doc_by_path(session, auth.tenant.id, path)
    previous = existing.content if existing else ""
    content = f"# {body.name}\n\n```json\n{json.dumps(body.manifest, indent=2, sort_keys=True)}\n```"
    doc = await upsert_doc(
        session,
        auth.tenant.id,
        path=path,
        content=content,
        kind="doc",
        internal=True,
        created_by_type="user",
        created_by_id=str(auth.user.id),
    )
    return {
        "slug": slug,
        "doc_id": str(doc.id),
        "created": existing is None,
        "changed": previous != content,
    }


@router.post("/modules/{slug}/diff")
async def diff_module_package(
    slug: str,
    body: ModulePackageBody,
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    """Return a compact manifest diff; applying remains an explicit save."""
    import json

    from app.services.workspace import get_doc_by_path

    doc = await get_doc_by_path(session, auth.tenant.id, f"modules/{slug}.md")
    current: dict[str, Any] = {}
    if doc:
        fenced = doc.content.split("```json", 1)
        if len(fenced) == 2:
            try:
                current = json.loads(fenced[1].split("```", 1)[0])
            except (json.JSONDecodeError, IndexError):
                current = {}
    keys = sorted(set(current) | set(body.manifest))
    return {
        "slug": slug,
        "changes": [
            {"key": key, "before": current.get(key), "after": body.manifest.get(key)}
            for key in keys
            if current.get(key) != body.manifest.get(key)
        ],
    }


@router.post("/process")
async def process_feedback(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    return await process_feedback_batch(session, auth.tenant.id)


@router.post("/eval/compute")
async def compute_eval(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
):
    auth.require_role("owner", "admin")
    rows = await compute_eval_scores(session, auth.tenant.id)
    guardrails = await apply_heuristic_guardrails(session, auth.tenant.id)
    return {"items": [serialize_eval(r) for r in rows], "guardrails": guardrails}


@router.get("/eval")
async def list_eval(
    auth: Annotated[AuthContext, Depends(get_current_auth)],
    session: Annotated[AsyncSession, Depends(get_session)],
    metric: str | None = None,
    limit: int = 20,
):
    from sqlalchemy import select

    from app.models.learning import EvalScore

    stmt = (
        select(EvalScore)
        .where(EvalScore.tenant_id == auth.tenant.id)
        .order_by(EvalScore.created_at.desc())
        .limit(min(limit, 100))
    )
    if metric:
        stmt = stmt.where(EvalScore.metric == metric)
    result = await session.execute(stmt)
    return {"items": [serialize_eval(r) for r in result.scalars().all()]}
