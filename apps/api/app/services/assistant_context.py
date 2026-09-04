"""Shared prompt context for in-app assistant turns.

Both assistant transports send the screen the operator is looking at with
every turn — the widget on the in-app surface and the Messages chat API —
so they format it the same way.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

MAX_PAGE_CONTEXT_CHARS = 500
MAX_BINDING_MAP_LINES = 24


def page_context_block(page_context: str) -> str:
    """System block describing what the operator currently has open."""
    text = " ".join((page_context or "").split())
    if not text:
        return ""
    return (
        "## Operator page context\n"
        f"The operator is currently viewing: {text[:MAX_PAGE_CONTEXT_CHARS]}\n"
        "Use this to ground your help in what they see on screen."
    )


async def case_binding_map_block(session: AsyncSession, tenant_id: UUID) -> str:
    """Compact routing map so agents know where each intake type goes."""
    from sqlalchemy import select

    from app.models.case import CaseType, CaseTypeBinding
    from app.models.orchestra import Workstream
    from app.models.project import Project
    from app.services.cases import ensure_platform_case_types

    await ensure_platform_case_types(session, tenant_id, commit=False)
    types = list(
        (
            await session.execute(
                select(CaseType)
                .where(CaseType.tenant_id == tenant_id, CaseType.enabled.is_(True))
                .order_by(CaseType.sort_order, CaseType.name)
            )
        ).scalars().all()
    )
    if not types:
        return ""
    bindings = list(
        (
            await session.execute(
                select(CaseTypeBinding).where(
                    CaseTypeBinding.tenant_id == tenant_id,
                    CaseTypeBinding.enabled.is_(True),
                )
            )
        ).scalars().all()
    )
    ws_ids = [b.target_id for b in bindings if b.target_kind == "workstream"]
    project_ids = [b.target_id for b in bindings if b.target_kind == "project"]
    ws_names: dict[UUID, str] = {}
    if ws_ids:
        streams = (
            await session.execute(
                select(Workstream).where(Workstream.tenant_id == tenant_id, Workstream.id.in_(ws_ids))
            )
        ).scalars().all()
        ws_names = {ws.id: ws.name for ws in streams}
    project_names: dict[UUID, str] = {}
    if project_ids:
        projects = (
            await session.execute(
                select(Project).where(Project.tenant_id == tenant_id, Project.id.in_(project_ids))
            )
        ).scalars().all()
        project_names = {p.id: p.name for p in projects}

    by_type: dict[UUID, list[CaseTypeBinding]] = {}
    for binding in bindings:
        by_type.setdefault(binding.case_type_id, []).append(binding)

    lines: list[str] = []
    for case_type in types[:MAX_BINDING_MAP_LINES]:
        hits = by_type.get(case_type.id) or []
        if not hits:
            lines.append(f"{case_type.slug} → none")
            continue
        parts: list[str] = []
        for binding in sorted(hits, key=lambda b: b.priority, reverse=True):
            if binding.target_kind == "workstream":
                label = ws_names.get(binding.target_id, "workstream")
                flag = " (auto_start)" if binding.auto_start_run else ""
                parts.append(f"workstream {label}{flag}")
            else:
                label = project_names.get(binding.target_id, "project")
                parts.append(f"project {label}")
        lines.append(f"{case_type.slug} → {'; '.join(parts)}")

    return (
        "## Case routing\n"
        "A case is typed intake on this conversation, not the conversation itself. "
        "Open one case per distinct intent. Never combine a bug and a billing question "
        "into one case. Use list_case_types then create_case. The type's mode and "
        "certainty decide whether you ask the visitor, ask the team, or open it.\n"
        + "\n".join(lines)
    )
