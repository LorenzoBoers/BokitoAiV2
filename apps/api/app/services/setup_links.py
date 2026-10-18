"""Write the relational copies of setup links.

The JSON on the source row stays so existing readers keep working. These
tables are what the organization map and new callers read.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.channel import ChannelAccount
from app.models.orchestra import Workstream
from app.models.relations import (
    ResourceGrant,
    WorkstreamStage,
    WorkstreamStageOwner,
)


def _uuid(value: Any) -> UUID | None:
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        return None


def apply_routing_columns(account: ChannelAccount) -> None:
    """Copy settings_json.routing onto the routing columns. A person wins."""
    try:
        settings = json.loads(account.settings_json or "{}")
    except json.JSONDecodeError:
        settings = {}
    routing = settings.get("routing") if isinstance(settings, dict) and isinstance(settings.get("routing"), dict) else {}
    user_id = _uuid(routing.get("user_id"))
    department_id = _uuid(routing.get("department_id") or routing.get("team_id"))
    if user_id is not None:
        department_id = None
    account.routing_user_id = user_id
    account.routing_department_id = department_id


async def replace_resource_grants(
    session: AsyncSession,
    tenant_id: UUID,
    resource_kind: str,
    entries: list[dict[str, str]] | None,
    *,
    channel_account_id: UUID | None = None,
    calendar_id: UUID | None = None,
    connection_id: UUID | None = None,
    module_install_id: UUID | None = None,
) -> None:
    """Replace grants for one resource. None leaves the table untouched."""
    if entries is None:
        return
    filters = [ResourceGrant.tenant_id == tenant_id, ResourceGrant.resource_kind == resource_kind]
    if channel_account_id is not None:
        filters.append(ResourceGrant.channel_account_id == channel_account_id)
    elif calendar_id is not None:
        filters.append(ResourceGrant.calendar_id == calendar_id)
    elif connection_id is not None:
        filters.append(ResourceGrant.connection_id == connection_id)
    elif module_install_id is not None:
        filters.append(ResourceGrant.module_install_id == module_install_id)
    await session.execute(delete(ResourceGrant).where(*filters))
    for entry in entries:
        kind = str(entry.get("kind") or entry.get("principal_kind") or "")
        level = str(entry.get("level") or "use")
        ident = str(entry.get("id") or "")
        principal = kind
        user_id = agent_id = department_id = None
        if kind == "user":
            user_id = _uuid(ident)
        elif kind == "agent":
            agent_id = _uuid(ident)
        elif kind == "department":
            from app.services.access_list import EVERYONE_SENTINELS
            from app.services.teams import ensure_all_department

            if ident in EVERYONE_SENTINELS:
                department_id = (await ensure_all_department(session, tenant_id)).id
            else:
                department_id = _uuid(ident)
        else:
            continue
        session.add(
            ResourceGrant(
                tenant_id=tenant_id,
                resource_kind=resource_kind,
                channel_account_id=channel_account_id,
                calendar_id=calendar_id,
                connection_id=connection_id,
                module_install_id=module_install_id,
                principal_kind=principal,
                user_id=user_id,
                agent_id=agent_id,
                department_id=department_id,
                level=level,
            )
        )


async def sync_flow_stages(session: AsyncSession, flow: Workstream) -> None:
    """Rebuild stage rows and owners from the flow's stages JSON."""
    try:
        stages = json.loads(flow.stages_json or "[]")
    except json.JSONDecodeError:
        stages = []
    if not isinstance(stages, list):
        stages = []
    existing = list(
        (
            await session.execute(
                select(WorkstreamStage).where(WorkstreamStage.workstream_id == flow.id)
            )
        ).scalars().all()
    )
    if existing:
        await session.execute(
            delete(WorkstreamStageOwner).where(
                WorkstreamStageOwner.stage_id.in_([row.id for row in existing])
            )
        )
        await session.execute(delete(WorkstreamStage).where(WorkstreamStage.workstream_id == flow.id))
    for position, stage in enumerate(stages):
        if not isinstance(stage, dict):
            continue
        row = WorkstreamStage(
            tenant_id=flow.tenant_id,
            workstream_id=flow.id,
            key=str(stage.get("key") or "")[:64] or "open",
            position=position,
            name=str(stage.get("name") or "")[:120],
            kind=str(stage.get("kind") or "open")[:16],
            checkup_minutes=int(stage.get("checkup_minutes") or 0),
        )
        session.add(row)
        await session.flush()
        owner = stage.get("owner") if isinstance(stage.get("owner"), dict) else None
        if not owner:
            continue
        kind = str(owner.get("kind") or "")
        if kind == "team":
            kind = "department"
        ident = _uuid(owner.get("id"))
        if ident is None or kind not in ("user", "agent", "department"):
            continue
        session.add(
            WorkstreamStageOwner(
                tenant_id=flow.tenant_id,
                stage_id=row.id,
                user_id=ident if kind == "user" else None,
                agent_id=ident if kind == "agent" else None,
                department_id=ident if kind == "department" else None,
            )
        )
