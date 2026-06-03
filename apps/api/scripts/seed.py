"""Seed Bokito test tenant for local development and automated tests."""

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select

from app.db.session import async_session_factory, init_db
from app.models.agent import Agent
from app.models.auth import Membership, Tenant, User
from app.models.blueprint import BlueprintBlock, BlueprintDoc, BlueprintPage
from app.models.email import EmailAccount
from app.models.integration import McpServer
from app.services.auth import hash_password
from app.services.agent.rag import upsert_index_chunk


TEST_EMAIL = "admin@bokito.ai"
TEST_PASSWORD = "bokito-test-password"


async def seed() -> None:
    await init_db()
    async with async_session_factory() as session:
        tenant_result = await session.execute(select(Tenant).where(Tenant.slug == "bokito"))
        tenant = tenant_result.scalar_one_or_none()
        if not tenant:
            tenant = Tenant(slug="bokito", name="Bokito", logo_url="/bokito-logo.svg")
            session.add(tenant)
            await session.flush()

        user_result = await session.execute(select(User).where(User.email == TEST_EMAIL))
        user = user_result.scalar_one_or_none()
        if not user:
            user = User(
                email=TEST_EMAIL,
                password_hash=hash_password(TEST_PASSWORD),
                display_name="Bokito Admin",
            )
            session.add(user)
            await session.flush()

        membership_result = await session.execute(
            select(Membership).where(Membership.user_id == user.id, Membership.tenant_id == tenant.id)
        )
        if not membership_result.scalar_one_or_none():
            session.add(Membership(tenant_id=tenant.id, user_id=user.id, role="admin"))

        agent_result = await session.execute(
            select(Agent).where(Agent.tenant_id == tenant.id, Agent.role == "assistant")
        )
        if not agent_result.scalar_one_or_none():
            session.add(
                Agent(
                    tenant_id=tenant.id,
                    name="Bokito Assistant",
                    role="assistant",
                    system_prompt="You are the Bokito AI OS assistant. Help users run their organization.",
                )
            )
            session.add(
                Agent(
                    tenant_id=tenant.id,
                    name="Bokito Orchestrator",
                    role="po",
                    system_prompt="You are the product owner orchestrator. Maintain blueprint and propose decisions.",
                )
            )
            session.add(
                Agent(
                    tenant_id=tenant.id,
                    name="Bokito Orchestra",
                    role="orchestra",
                    system_prompt="Proactively scan for improvements and suggest integrations.",
                )
            )
            session.add(
                Agent(
                    tenant_id=tenant.id,
                    name="Bokito Coding Agent",
                    role="coding",
                    system_prompt="Implement code changes in the Bokito repository when approved.",
                )
            )

        doc_result = await session.execute(select(BlueprintDoc).where(BlueprintDoc.tenant_id == tenant.id))
        doc = doc_result.scalar_one_or_none()
        if not doc:
            doc = BlueprintDoc(tenant_id=tenant.id, title="Bokito Blueprint")
            session.add(doc)
            await session.flush()
            overview = BlueprintPage(
                doc_id=doc.id,
                tenant_id=tenant.id,
                title="Platform Overview",
                slug="overview",
                kind="prd",
            )
            sop = BlueprintPage(
                doc_id=doc.id,
                tenant_id=tenant.id,
                title="Operations SOP",
                slug="operations-sop",
                kind="sop",
            )
            session.add(overview)
            session.add(sop)
            await session.flush()
            block = BlueprintBlock(
                page_id=overview.id,
                tenant_id=tenant.id,
                block_type="paragraph",
                content_json=json.dumps(
                    {
                        "text": "Bokito AI OS provides per-tenant assistants, blueprint docs, integrations, and decision workflows."
                    }
                ),
            )
            session.add(block)
            await session.flush()
            await upsert_index_chunk(
                session,
                tenant.id,
                "blueprint_block",
                str(block.id),
                overview.title,
                "Bokito AI OS provides per-tenant assistants, blueprint docs, integrations, and decision workflows.",
            )

        email_result = await session.execute(select(EmailAccount).where(EmailAccount.tenant_id == tenant.id))
        if not email_result.scalar_one_or_none():
            session.add(
                EmailAccount(
                    tenant_id=tenant.id,
                    email_address="support@bokito.ai",
                    provider="mock",
                )
            )

        mcp_result = await session.execute(select(McpServer).where(McpServer.tenant_id == tenant.id))
        if not mcp_result.scalar_one_or_none():
            session.add(
                McpServer(
                    tenant_id=tenant.id,
                    name="mock-tools",
                    server_url="mock://local",
                    auth_json="{}",
                )
            )

        await session.commit()
        print(f"Seeded tenant={tenant.slug} user={TEST_EMAIL} password={TEST_PASSWORD}")


if __name__ == "__main__":
    asyncio.run(seed())
