"""Case intake: typed nodes on a Signal thread, routed by CaseTypeBinding."""

from __future__ import annotations

import json
import re
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.case import (
    CASE_AUDIENCES,
    CASE_BINDING_TARGETS,
    CASE_CREATE_MODES,
    CASE_PROJECT_LINK,
    CASE_STATUSES,
    Case,
    CaseType,
    CaseTypeBinding,
)
from app.models.orchestra import Workstream
from app.models.project import Project
from app.models.signal import Signal
from app.services.customer_verify import thread_assurance_valid

_SLUG_RE = re.compile(r"[^a-z0-9]+")

PLATFORM_CASE_TYPES: tuple[dict[str, Any], ...] = (
    {
        "slug": "complaint",
        "name": "Complaint",
        "description": "A customer is unhappy and wants this recorded.",
        "create_mode": "ask_customer",
        "ask_threshold": 6,
        "auto_threshold": 11,
        "audience": "customer",
        "sort_order": 10,
    },
    {
        "slug": "bug_report",
        "name": "Bug report",
        "description": "Something is broken and should be looked at.",
        "create_mode": "ask_customer",
        "ask_threshold": 6,
        "auto_threshold": 9,
        "audience": "both",
        "sort_order": 20,
    },
    {
        "slug": "feature_request",
        "name": "Feature request",
        "description": "A request for a new capability.",
        "create_mode": "ask_customer",
        "ask_threshold": 6,
        "auto_threshold": 11,
        "audience": "both",
        "sort_order": 30,
    },
    {
        "slug": "spam_abuse",
        "name": "Spam or abuse",
        "description": "Unwanted or abusive inbound that should be closed quickly.",
        "create_mode": "auto",
        "ask_threshold": 3,
        "auto_threshold": 7,
        "audience": "internal",
        "sort_order": 40,
    },
)


def slugify(value: str) -> str:
    text = _SLUG_RE.sub("-", (value or "").strip().lower()).strip("-")
    return text[:64] or "case"


def serialize_case_type(row: CaseType) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "slug": row.slug,
        "name": row.name,
        "description": row.description,
        "create_mode": row.create_mode,
        "ask_threshold": row.ask_threshold,
        "auto_threshold": row.auto_threshold,
        "requires_verification": row.requires_verification,
        "allow_project_link": row.allow_project_link,
        "audience": row.audience,
        "enabled": row.enabled,
        "module_slug": row.module_slug,
        "template_slug": row.template_slug,
        "sort_order": row.sort_order,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def serialize_binding(row: CaseTypeBinding) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "case_type_id": str(row.case_type_id),
        "target_kind": row.target_kind,
        "target_id": str(row.target_id),
        "priority": row.priority,
        "auto_link": row.auto_link,
        "auto_start_run": row.auto_start_run,
        "enabled": row.enabled,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def serialize_case(row: Case, case_type: CaseType | None = None) -> dict[str, Any]:
    try:
        payload = json.loads(row.payload_json or "{}")
    except json.JSONDecodeError:
        payload = {}
    return {
        "id": str(row.id),
        "case_type_id": str(row.case_type_id),
        "case_type": serialize_case_type(case_type) if case_type else None,
        "signal_id": str(row.signal_id),
        "contact_id": str(row.contact_id) if row.contact_id else None,
        "project_id": str(row.project_id) if row.project_id else None,
        "workstream_id": str(row.workstream_id) if row.workstream_id else None,
        "workstream_run_id": str(row.workstream_run_id) if row.workstream_run_id else None,
        "title": row.title,
        "summary": row.summary,
        "payload": payload if isinstance(payload, dict) else {},
        "status": row.status,
        "certainty": row.certainty,
        "create_mode_used": row.create_mode_used,
        "created_by_type": row.created_by_type,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


async def ensure_platform_case_types(
    session: AsyncSession, tenant_id: UUID, *, commit: bool = True
) -> None:
    existing = set(
        (
            await session.execute(
                select(CaseType.slug).where(CaseType.tenant_id == tenant_id)
            )
        ).scalars()
    )
    now = datetime.utcnow()
    added = False
    for spec in PLATFORM_CASE_TYPES:
        if spec["slug"] in existing:
            continue
        session.add(
            CaseType(
                tenant_id=tenant_id,
                slug=spec["slug"],
                name=spec["name"],
                description=spec["description"],
                create_mode=spec["create_mode"],
                ask_threshold=int(spec["ask_threshold"]),
                auto_threshold=int(spec["auto_threshold"]),
                audience=spec["audience"],
                sort_order=int(spec["sort_order"]),
                created_at=now,
                updated_at=now,
            )
        )
        added = True
    if added:
        if commit:
            await session.commit()
        else:
            await session.flush()


async def install_case_type_template(
    session: AsyncSession, tenant_id: UUID, module_slug: str, template_slug: str
) -> CaseType:
    from app.modules.catalog import get_case_type_template

    template = get_case_type_template(module_slug, template_slug)
    if template is None:
        raise HTTPException(status_code=404, detail="Case type template not found")
    existing = (
        await session.execute(
            select(CaseType).where(
                CaseType.tenant_id == tenant_id,
                CaseType.template_slug == template.slug,
                CaseType.module_slug == module_slug,
            )
        )
    ).scalar_one_or_none()
    if existing:
        return existing
    return await create_case_type(
        session,
        tenant_id,
        name=template.name,
        slug=template.slug,
        description=template.description,
        create_mode=template.create_mode,
        ask_threshold=template.ask_threshold,
        auto_threshold=template.auto_threshold,
        requires_verification=template.requires_verification,
        audience=template.audience,
        module_slug=module_slug,
        template_slug=template.slug,
    )


async def list_case_types(session: AsyncSession, tenant_id: UUID) -> list[CaseType]:
    await ensure_platform_case_types(session, tenant_id)
    result = await session.execute(
        select(CaseType)
        .where(CaseType.tenant_id == tenant_id)
        .order_by(CaseType.sort_order, CaseType.name)
    )
    return list(result.scalars().all())


async def get_case_type(
    session: AsyncSession, tenant_id: UUID, type_id: UUID
) -> CaseType:
    row = (
        await session.execute(
            select(CaseType).where(CaseType.id == type_id, CaseType.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Case type not found")
    return row


async def create_case_type(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    name: str,
    slug: str = "",
    description: str = "",
    create_mode: str = "ask_customer",
    ask_threshold: int = 6,
    auto_threshold: int = 9,
    requires_verification: bool = False,
    allow_project_link: str = "optional",
    audience: str = "both",
    enabled: bool = True,
    module_slug: str = "",
    template_slug: str = "",
    sort_order: int = 0,
    commit: bool = True,
) -> CaseType:
    slug = slugify(slug or name)
    if create_mode not in CASE_CREATE_MODES:
        raise HTTPException(status_code=400, detail="Invalid create_mode")
    if audience not in CASE_AUDIENCES:
        raise HTTPException(status_code=400, detail="Invalid audience")
    if allow_project_link not in CASE_PROJECT_LINK:
        raise HTTPException(status_code=400, detail="Invalid allow_project_link")
    clash = (
        await session.execute(
            select(CaseType).where(CaseType.tenant_id == tenant_id, CaseType.slug == slug)
        )
    ).scalar_one_or_none()
    if clash:
        raise HTTPException(status_code=409, detail="A case type with this slug already exists")
    row = CaseType(
        tenant_id=tenant_id,
        slug=slug,
        name=name.strip() or slug,
        description=description,
        create_mode=create_mode,
        ask_threshold=max(0, min(11, int(ask_threshold))),
        auto_threshold=max(0, min(11, int(auto_threshold))),
        requires_verification=requires_verification,
        allow_project_link=allow_project_link,
        audience=audience,
        enabled=enabled,
        module_slug=module_slug,
        template_slug=template_slug,
        sort_order=sort_order,
    )
    session.add(row)
    if commit:
        await session.commit()
        await session.refresh(row)
    else:
        await session.flush()
    return row


async def update_case_type(
    session: AsyncSession,
    tenant_id: UUID,
    type_id: UUID,
    patch: dict[str, Any],
    *,
    commit: bool = True,
) -> CaseType:
    row = await get_case_type(session, tenant_id, type_id)
    if "name" in patch and patch["name"] is not None:
        row.name = str(patch["name"]).strip() or row.name
    if "description" in patch and patch["description"] is not None:
        row.description = str(patch["description"])
    if "create_mode" in patch and patch["create_mode"] is not None:
        if patch["create_mode"] not in CASE_CREATE_MODES:
            raise HTTPException(status_code=400, detail="Invalid create_mode")
        row.create_mode = patch["create_mode"]
    if "ask_threshold" in patch and patch["ask_threshold"] is not None:
        row.ask_threshold = max(0, min(11, int(patch["ask_threshold"])))
    if "auto_threshold" in patch and patch["auto_threshold"] is not None:
        row.auto_threshold = max(0, min(11, int(patch["auto_threshold"])))
    if "requires_verification" in patch and patch["requires_verification"] is not None:
        row.requires_verification = bool(patch["requires_verification"])
    if "allow_project_link" in patch and patch["allow_project_link"] is not None:
        if patch["allow_project_link"] not in CASE_PROJECT_LINK:
            raise HTTPException(status_code=400, detail="Invalid allow_project_link")
        row.allow_project_link = patch["allow_project_link"]
    if "audience" in patch and patch["audience"] is not None:
        if patch["audience"] not in CASE_AUDIENCES:
            raise HTTPException(status_code=400, detail="Invalid audience")
        row.audience = patch["audience"]
    if "enabled" in patch and patch["enabled"] is not None:
        row.enabled = bool(patch["enabled"])
    if "sort_order" in patch and patch["sort_order"] is not None:
        row.sort_order = int(patch["sort_order"])
    row.updated_at = datetime.utcnow()
    session.add(row)
    if commit:
        await session.commit()
        await session.refresh(row)
    else:
        await session.flush()
    return row


async def delete_case_type(
    session: AsyncSession, tenant_id: UUID, type_id: UUID, *, commit: bool = True
) -> None:
    row = await get_case_type(session, tenant_id, type_id)
    bindings = (
        await session.execute(
            select(CaseTypeBinding).where(
                CaseTypeBinding.tenant_id == tenant_id,
                CaseTypeBinding.case_type_id == type_id,
            )
        )
    ).scalars().all()
    for binding in bindings:
        await session.delete(binding)
    await session.delete(row)
    if commit:
        await session.commit()
    else:
        await session.flush()


async def list_bindings(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    case_type_id: UUID | None = None,
    target_kind: str | None = None,
    target_id: UUID | None = None,
) -> list[CaseTypeBinding]:
    stmt = select(CaseTypeBinding).where(CaseTypeBinding.tenant_id == tenant_id)
    if case_type_id:
        stmt = stmt.where(CaseTypeBinding.case_type_id == case_type_id)
    if target_kind:
        stmt = stmt.where(CaseTypeBinding.target_kind == target_kind)
    if target_id:
        stmt = stmt.where(CaseTypeBinding.target_id == target_id)
    stmt = stmt.order_by(CaseTypeBinding.priority.desc())
    return list((await session.execute(stmt)).scalars().all())


async def create_binding(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    case_type_id: UUID,
    target_kind: str,
    target_id: UUID,
    priority: int = 0,
    auto_link: bool = True,
    auto_start_run: bool = False,
    enabled: bool = True,
    commit: bool = True,
) -> CaseTypeBinding:
    await get_case_type(session, tenant_id, case_type_id)
    if target_kind not in CASE_BINDING_TARGETS:
        raise HTTPException(status_code=400, detail="Invalid target_kind")
    if target_kind == "workstream":
        ws = (
            await session.execute(
                select(Workstream).where(
                    Workstream.id == target_id, Workstream.tenant_id == tenant_id
                )
            )
        ).scalar_one_or_none()
        if ws is None:
            raise HTTPException(status_code=404, detail="Workstream not found")
    elif target_kind == "project":
        project = (
            await session.execute(
                select(Project).where(Project.id == target_id, Project.tenant_id == tenant_id)
            )
        ).scalar_one_or_none()
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")
    clash = (
        await session.execute(
            select(CaseTypeBinding).where(
                CaseTypeBinding.tenant_id == tenant_id,
                CaseTypeBinding.case_type_id == case_type_id,
                CaseTypeBinding.target_kind == target_kind,
                CaseTypeBinding.target_id == target_id,
            )
        )
    ).scalar_one_or_none()
    if clash:
        raise HTTPException(status_code=409, detail="Binding already exists")
    row = CaseTypeBinding(
        tenant_id=tenant_id,
        case_type_id=case_type_id,
        target_kind=target_kind,
        target_id=target_id,
        priority=int(priority),
        auto_link=auto_link,
        auto_start_run=auto_start_run,
        enabled=enabled,
    )
    session.add(row)
    if commit:
        await session.commit()
        await session.refresh(row)
    else:
        await session.flush()
    return row


async def delete_binding(
    session: AsyncSession, tenant_id: UUID, binding_id: UUID, *, commit: bool = True
) -> None:
    row = (
        await session.execute(
            select(CaseTypeBinding).where(
                CaseTypeBinding.id == binding_id, CaseTypeBinding.tenant_id == tenant_id
            )
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Binding not found")
    await session.delete(row)
    if commit:
        await session.commit()
    else:
        await session.flush()


async def resolve_case_bindings(
    session: AsyncSession,
    tenant_id: UUID,
    case_type_id: UUID,
    *,
    project_id: UUID | None = None,
) -> list[CaseTypeBinding]:
    """Project-scoped bindings beat tenant-scoped, then priority."""
    rows = await list_bindings(session, tenant_id, case_type_id=case_type_id)
    rows = [b for b in rows if b.enabled]
    if not rows:
        return []

    workstream_ids = [b.target_id for b in rows if b.target_kind == "workstream"]
    ws_project: dict[UUID, UUID | None] = {}
    if workstream_ids:
        streams = (
            await session.execute(
                select(Workstream).where(
                    Workstream.tenant_id == tenant_id, Workstream.id.in_(workstream_ids)
                )
            )
        ).scalars().all()
        ws_project = {ws.id: ws.project_id for ws in streams}

    def is_project_scoped(binding: CaseTypeBinding) -> bool:
        if project_id is None:
            return False
        if binding.target_kind == "project":
            return binding.target_id == project_id
        if binding.target_kind == "workstream":
            return ws_project.get(binding.target_id) == project_id
        return False

    scoped = [b for b in rows if is_project_scoped(b)]
    chosen = scoped or rows
    return sorted(chosen, key=lambda b: b.priority, reverse=True)


async def list_cases(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    signal_id: UUID | None = None,
    status: str | None = None,
    case_type_id: UUID | None = None,
    q: str | None = None,
    limit: int | None = None,
    offset: int | None = None,
) -> list[tuple[Case, CaseType]]:
    stmt = (
        select(Case, CaseType)
        .join(CaseType, Case.case_type_id == CaseType.id)
        .where(Case.tenant_id == tenant_id)
        .order_by(Case.created_at.desc())
    )
    if signal_id:
        stmt = stmt.where(Case.signal_id == signal_id)
    if status:
        stmt = stmt.where(Case.status == status)
    if case_type_id:
        stmt = stmt.where(Case.case_type_id == case_type_id)
    if q and q.strip():
        needle = f"%{q.strip()}%"
        stmt = stmt.where(
            Case.title.ilike(needle)  # type: ignore[attr-defined]
            | Case.summary.ilike(needle)  # type: ignore[attr-defined]
            | CaseType.name.ilike(needle)  # type: ignore[attr-defined]
        )
    if offset:
        stmt = stmt.offset(max(0, int(offset)))
    if limit:
        stmt = stmt.limit(max(1, min(500, int(limit))))
    return list((await session.execute(stmt)).all())


async def case_stats(session: AsyncSession, tenant_id: UUID) -> dict[str, int]:
    """Case counts per status for the hub queue pills (tenant-scoped)."""
    from sqlalchemy import func

    rows = (
        await session.execute(
            select(Case.status, func.count())
            .where(Case.tenant_id == tenant_id)
            .group_by(Case.status)
        )
    ).all()
    counts = {status: 0 for status in CASE_STATUSES}
    for status, count in rows:
        counts[status] = int(count)
    return counts


async def signal_subjects(
    session: AsyncSession, tenant_id: UUID, signal_ids: list[UUID]
) -> dict[str, str]:
    """Bulk lookup of thread subjects for hub queue rows (avoids N+1)."""
    if not signal_ids:
        return {}
    rows = (
        await session.execute(
            select(Signal.id, Signal.subject).where(
                Signal.tenant_id == tenant_id, Signal.id.in_(signal_ids)
            )
        )
    ).all()
    return {str(signal_id): subject or "" for signal_id, subject in rows}


async def get_case(session: AsyncSession, tenant_id: UUID, case_id: UUID) -> tuple[Case, CaseType]:
    row = (
        await session.execute(
            select(Case, CaseType)
            .join(CaseType, Case.case_type_id == CaseType.id)
            .where(Case.id == case_id, Case.tenant_id == tenant_id)
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Case not found")
    return row


async def _status_update(session: AsyncSession, tenant_id: UUID, signal_id: UUID, text: str) -> None:
    from app.models.signal import SignalMessage
    from app.gateway.publish import publish_signal_message

    signal = (
        await session.execute(
            select(Signal).where(Signal.id == signal_id, Signal.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if signal is None:
        return
    now = datetime.utcnow()
    message = SignalMessage(
        signal_id=signal.id,
        tenant_id=tenant_id,
        kind="status_update",
        role="assistant",
        direction="outbound",
        body_text=text,
        body_preview=text[:200],
        received_at=now,
    )
    session.add(message)
    signal.last_message_at = now
    signal.updated_at = now
    session.add(signal)
    await session.flush()
    await publish_signal_message(signal, message)


async def _ask_operator_decision(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    signal_id: UUID,
    case: Case,
    case_type: CaseType,
    bindings: list[CaseTypeBinding],
    user_id: UUID | None,
    agent_id: UUID | None,
) -> None:
    from app.services.signal_decisions import create_decision

    options: list[dict[str, Any]] = []
    if len(bindings) > 1:
        for binding in bindings:
            options.append(
                {
                    "id": f"link:{binding.id}",
                    "label": f"Link to {binding.target_kind}",
                    "action_type": "link_case",
                    "payload": {
                        "case_id": str(case.id),
                        "target_kind": binding.target_kind,
                        "target_id": str(binding.target_id),
                        "auto_start_run": binding.auto_start_run,
                    },
                }
            )
    else:
        options.append(
            {
                "id": "approve",
                "label": "Open this case",
                "action_type": "update_case",
                "payload": {"case_id": str(case.id), "status": "open"},
            }
        )
    options.append({"id": "reject", "label": "Dismiss", "action_type": "update_case",
                    "payload": {"case_id": str(case.id), "status": "cancelled"}})
    await create_decision(
        session,
        tenant_id,
        title=f"{case_type.name}: {case.title or case_type.name}",
        summary=case.summary or f"Review this {case_type.name.lower()} from the conversation.",
        options=options,
        user_id=user_id,
        agent_id=agent_id,
        signal_id=signal_id,
        source_type="case",
        source_id=str(case.id),
    )
    await _status_update(
        session,
        tenant_id,
        signal_id,
        "I've asked the team to review this. You can keep talking here.",
    )


async def link_case(
    session: AsyncSession,
    tenant_id: UUID,
    case_id: UUID,
    *,
    target_kind: str,
    target_id: UUID,
    auto_start_run: bool = False,
    created_by_type: str = "user",
    created_by_id: str = "",
) -> Case:
    case, _case_type = await get_case(session, tenant_id, case_id)
    if target_kind == "project":
        case.project_id = target_id
    elif target_kind == "workstream":
        case.workstream_id = target_id
        if auto_start_run:
            from app.services.workstreams import start_run

            run = await start_run(
                session,
                tenant_id,
                target_id,
                input_kind="case",
                input_text=case.summary or case.title,
                input_ref=str(case.id),
                triggered_by_type=created_by_type,
                triggered_by_id=created_by_id,
            )
            case.workstream_run_id = run.id
            case.project_id = case.project_id or run.project_id
    else:
        raise HTTPException(status_code=400, detail="Invalid target_kind")
    case.status = "linked"
    case.updated_at = datetime.utcnow()
    session.add(case)
    await session.commit()
    await session.refresh(case)
    return case


async def create_case(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    case_type_id: UUID,
    signal_id: UUID,
    title: str = "",
    summary: str = "",
    payload: dict[str, Any] | None = None,
    certainty: int | None = None,
    project_id: UUID | None = None,
    actor: str = "operator",
    created_by_type: str = "user",
    created_by_id: str = "",
    user_id: UUID | None = None,
    agent_id: UUID | None = None,
) -> dict[str, Any]:
    case_type = await get_case_type(session, tenant_id, case_type_id)
    if not case_type.enabled:
        raise HTTPException(status_code=400, detail="This case type is disabled")
    signal = (
        await session.execute(
            select(Signal).where(Signal.id == signal_id, Signal.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()
    if signal is None:
        raise HTTPException(status_code=404, detail="Thread not found")

    score = 10 if certainty is None and actor == "operator" else int(certainty or 0)
    score = max(0, min(10, score))
    project_id = project_id or signal.project_id

    if case_type.requires_verification and actor != "operator":
        if not thread_assurance_valid(signal):
            case = Case(
                tenant_id=tenant_id,
                case_type_id=case_type.id,
                signal_id=signal.id,
                contact_id=signal.contact_id,
                project_id=project_id,
                title=title.strip() or case_type.name,
                summary=summary.strip(),
                payload_json=json.dumps(payload or {}),
                status="waiting_customer",
                certainty=score,
                create_mode_used=case_type.create_mode,
                created_by_type=created_by_type,
                created_by_id=created_by_id,
            )
            session.add(case)
            await session.commit()
            await session.refresh(case)
            return {
                "case": serialize_case(case, case_type),
                "status": "needs_verification",
                "note": "Ask the visitor to confirm their email before this case can continue.",
            }

    mode = case_type.create_mode
    if actor == "operator":
        status = "open"
        ask_operator = False
    elif mode == "manual_only":
        status = "proposed"
        ask_operator = False
    elif mode == "ask_operator":
        status = "waiting_operator"
        ask_operator = True
    elif mode == "auto":
        if case_type.auto_threshold >= 11 or score < case_type.auto_threshold:
            status = "waiting_operator"
            ask_operator = True
        else:
            status = "open"
            ask_operator = False
    else:  # ask_customer
        if score < case_type.ask_threshold:
            status = "proposed"
            ask_operator = False
        elif case_type.auto_threshold < 11 and score >= case_type.auto_threshold:
            status = "open"
            ask_operator = False
        else:
            status = "proposed"
            ask_operator = False

    case = Case(
        tenant_id=tenant_id,
        case_type_id=case_type.id,
        signal_id=signal.id,
        contact_id=signal.contact_id or signal.assurance_contact_id,
        project_id=project_id,
        title=title.strip() or case_type.name,
        summary=summary.strip(),
        payload_json=json.dumps(payload or {}),
        status=status,
        certainty=score,
        create_mode_used=mode,
        created_by_type=created_by_type,
        created_by_id=created_by_id,
    )
    session.add(case)
    await session.commit()
    await session.refresh(case)

    bindings = await resolve_case_bindings(
        session, tenant_id, case_type.id, project_id=project_id
    )
    extra: dict[str, Any] = {"bindings": len(bindings)}

    if ask_operator or (actor != "operator" and len(bindings) > 1):
        case.status = "waiting_operator"
        session.add(case)
        await session.commit()
        await _ask_operator_decision(
            session,
            tenant_id,
            signal_id=signal.id,
            case=case,
            case_type=case_type,
            bindings=bindings,
            user_id=user_id,
            agent_id=agent_id,
        )
        extra["asked_operator"] = True
        return {"case": serialize_case(case, case_type), **extra}

    if actor != "operator" and status == "proposed":
        extra["asked_customer"] = True
        return {"case": serialize_case(case, case_type), **extra}

    if len(bindings) == 1 and bindings[0].auto_link:
        case = await link_case(
            session,
            tenant_id,
            case.id,
            target_kind=bindings[0].target_kind,
            target_id=bindings[0].target_id,
            auto_start_run=bindings[0].auto_start_run,
            created_by_type=created_by_type,
            created_by_id=created_by_id,
        )
        extra["linked"] = True
    return {"case": serialize_case(case, case_type), **extra}


async def update_case(
    session: AsyncSession,
    tenant_id: UUID,
    case_id: UUID,
    patch: dict[str, Any],
) -> Case:
    case, _case_type = await get_case(session, tenant_id, case_id)
    if "title" in patch and patch["title"] is not None:
        case.title = str(patch["title"]).strip()
    if "summary" in patch and patch["summary"] is not None:
        case.summary = str(patch["summary"])
    if "status" in patch and patch["status"] is not None:
        if patch["status"] not in CASE_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid status")
        case.status = patch["status"]
    if "project_id" in patch:
        raw = patch["project_id"]
        case.project_id = UUID(str(raw)) if raw else None
    if "payload" in patch and isinstance(patch["payload"], dict):
        case.payload_json = json.dumps(patch["payload"])
    case.updated_at = datetime.utcnow()
    session.add(case)
    await session.commit()
    await session.refresh(case)
    return case
