"""Fill the Bokito tenant's new setup-link tables. Idempotent. Dev only."""

from __future__ import annotations

import asyncio
import os
from datetime import datetime
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.models.agent_scope import AgentScope
from app.models.project import Project
from app.models.relations import WorkstreamChannel, WorkstreamConnection
from app.models.team import Team
from app.models.webhook import WebhookEndpoint

TENANT = UUID("231e4ade-6b58-494b-9042-ec860d845a0e")
BUG = UUID("f5c82223-15d2-4f02-ad25-974e16b3895e")
FEATURE = UUID("67b590a7-9bba-40e4-bb8a-521515734db7")
SUPPORT_FLOW = UUID("60e50cf6-a807-4ded-9da8-39412c4de7f1")
WEBSITE = UUID("54db2b77-c50d-4c1b-83a9-689bdaca01ed")
SUPPORT_MAIL = UUID("86316e77-f469-42de-86f0-6fabdac3f447")
CUSTOM_MCP = UUID("19e98071-9f2e-42b4-ad89-be8f4fcf3f32")
DEV_FOLDER = UUID("1890e9e4-4664-4760-a007-0ecba27c759b")
PLATFORM_FOLDER = UUID("a1bca1a1-3a79-417a-96cf-a4d3ae095582")
ORCHESTRATOR = UUID("cc965b16-aff8-44a2-a0ea-29ebd4e5bccf")


async def _one(session: AsyncSession, model, *where):
    return (await session.execute(select(model).where(*where))).scalar_one_or_none()


async def main() -> None:
    engine = create_async_engine(os.environ["DATABASE_URL"])
    Session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with Session() as session:
        development = (
            await session.execute(
                select(Team).where(Team.tenant_id == TENANT, Team.name == "Development")
            )
        ).scalar_one()
        support = (
            await session.execute(select(Team).where(Team.tenant_id == TENANT, Team.name == "Support"))
        ).scalar_one()

        binds = [
            (SUPPORT_FLOW, SUPPORT_MAIL),
            (SUPPORT_FLOW, WEBSITE),
            (BUG, WEBSITE),
        ]
        for flow_id, channel_id in binds:
            if await _one(
                session,
                WorkstreamChannel,
                WorkstreamChannel.workstream_id == flow_id,
                WorkstreamChannel.channel_account_id == channel_id,
            ):
                continue
            session.add(
                WorkstreamChannel(
                    workstream_id=flow_id,
                    channel_account_id=channel_id,
                    tenant_id=TENANT,
                )
            )

        connections = [
            (BUG, CUSTOM_MCP, "write"),
            (FEATURE, CUSTOM_MCP, "read"),
        ]
        for flow_id, connection_id, purpose in connections:
            row = await _one(
                session,
                WorkstreamConnection,
                WorkstreamConnection.workstream_id == flow_id,
                WorkstreamConnection.connection_id == connection_id,
            )
            if row is None:
                session.add(
                    WorkstreamConnection(
                        workstream_id=flow_id,
                        connection_id=connection_id,
                        tenant_id=TENANT,
                        purpose=purpose,
                    )
                )
            else:
                row.purpose = purpose

        scope = await _one(
            session,
            AgentScope,
            AgentScope.tenant_id == TENANT,
            AgentScope.agent_id == ORCHESTRATOR,
            AgentScope.resource_kind == "connection",
            AgentScope.resource_id == str(CUSTOM_MCP),
        )
        if scope is None:
            session.add(
                AgentScope(
                    tenant_id=TENANT,
                    agent_id=ORCHESTRATOR,
                    resource_kind="connection",
                    resource_id=str(CUSTOM_MCP),
                    connection_id=CUSTOM_MCP,
                    can_write=True,
                )
            )

        for folder_id, department_id in (
            (DEV_FOLDER, development.id),
            (PLATFORM_FOLDER, development.id),
        ):
            folder = await session.get(Project, folder_id)
            if folder is not None and folder.tenant_id == TENANT:
                folder.department_id = department_id

        hook = await _one(
            session,
            WebhookEndpoint,
            WebhookEndpoint.tenant_id == TENANT,
            WebhookEndpoint.description == "Bug status",
        )
        if hook is None:
            session.add(
                WebhookEndpoint(
                    tenant_id=TENANT,
                    url="https://dev.app.bokito.ai/hooks/bug-status",
                    description="Bug status",
                    events_json='["signal.updated"]',
                    workstream_id=BUG,
                    active=True,
                    created_at=datetime.utcnow(),
                    updated_at=datetime.utcnow(),
                )
            )
        else:
            hook.workstream_id = BUG

        # Support mailbox already routes to Support. Keep the column if the JSON backfill missed it.
        await session.execute(
            text(
                "UPDATE channel_accounts SET routing_department_id = :dept "
                "WHERE id = :id AND routing_user_id IS NULL"
            ),
            {"dept": support.id, "id": SUPPORT_MAIL},
        )
        await session.commit()
        print("seeded setup links", development.id, support.id)
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
