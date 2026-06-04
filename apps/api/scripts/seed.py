"""Seed Bokito test tenant for local development and automated tests."""

import asyncio
import json
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select

from app.db.session import async_session_factory, init_db
from app.models.agent import Agent
from app.models.auth import Membership, Tenant, User
from app.models.blueprint import BlueprintBlock, BlueprintDoc, BlueprintPage
from app.models.email import EmailAccount
from app.models.inbox import InboxSettings
from app.models.inbox_threads import InboxEvent, InboxMessage, InboxThread
from app.models.integration import McpServer
from app.models.policy import ActionPolicy, AssistantPersona
from app.models.project import Project, ProjectOrchestration
from app.models.workforce_message import WorkforceMessage
from app.services.auth import hash_password
from app.services.agent.rag import upsert_index_chunk
from app.services.tenant_bootstrap import bootstrap_tenant, default_tenant_settings, serialize_settings


TEST_EMAIL = "admin@bokito.ai"
TEST_PASSWORD = "bokito-test-password"
STAFF_EMAIL = "staff@bokito.ai"
DEMO_EMAIL = "owner@demo.local"
DEMO_PASSWORD = "demo-test-password"


async def seed() -> None:
    await init_db()
    async with async_session_factory() as session:
        # Staff user
        staff_result = await session.execute(select(User).where(User.email == STAFF_EMAIL))
        staff = staff_result.scalar_one_or_none()
        if not staff:
            staff = User(
                email=STAFF_EMAIL,
                password_hash=hash_password(TEST_PASSWORD),
                display_name="Bokito Staff",
                is_staff=True,
            )
            session.add(staff)

        # Bokito tenant
        tenant_result = await session.execute(select(Tenant).where(Tenant.slug == "bokito"))
        tenant = tenant_result.scalar_one_or_none()
        if not tenant:
            tenant = Tenant(
                slug="bokito",
                name="Bokito",
                logo_url="/bokito-logo.svg",
                settings_json=serialize_settings(default_tenant_settings()),
            )
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
            session.add(Membership(tenant_id=tenant.id, user_id=user.id, role="owner"))

        await _seed_tenant_data(session, tenant)

        # Demo tenant for isolation tests
        demo_result = await session.execute(select(Tenant).where(Tenant.slug == "demo"))
        demo = demo_result.scalar_one_or_none()
        if not demo:
            demo = Tenant(slug="demo", name="Demo Co", settings_json=serialize_settings(default_tenant_settings()))
            session.add(demo)
            await session.flush()
            demo_user = User(
                email=DEMO_EMAIL,
                password_hash=hash_password(DEMO_PASSWORD),
                display_name="Demo Owner",
            )
            session.add(demo_user)
            await session.flush()
            session.add(Membership(tenant_id=demo.id, user_id=demo_user.id, role="owner"))
            await bootstrap_tenant(session, demo.id)

        await session.commit()
        print(f"Seeded tenant={tenant.slug} user={TEST_EMAIL} password={TEST_PASSWORD}")
        print(f"Staff={STAFF_EMAIL} demo={DEMO_EMAIL} password={DEMO_PASSWORD}")


async def _seed_tenant_data(session, tenant):
    agent_result = await session.execute(
        select(Agent).where(Agent.tenant_id == tenant.id, Agent.role == "assistant")
    )
    if not agent_result.scalar_one_or_none():
        session.add(
            Agent(
                tenant_id=tenant.id,
                name="Bokito Assistant",
                role="assistant",
                slug="assistant",
                runtime_status="standby",
                system_prompt="You are the Bokito AI OS assistant.",
            )
        )
        session.add(
            Agent(
                tenant_id=tenant.id,
                name="Orchestrator",
                role="orchestrator",
                slug="manager",
                runtime_status="standby",
                system_prompt="You are the PM orchestrator.",
            )
        )

    if not (
        await session.execute(select(InboxSettings).where(InboxSettings.tenant_id == tenant.id))
    ).scalar_one_or_none():
        session.add(InboxSettings(tenant_id=tenant.id))
        session.add(ActionPolicy(tenant_id=tenant.id))
        session.add(AssistantPersona(tenant_id=tenant.id, tone="Professional"))

    doc_result = await session.execute(select(BlueprintDoc).where(BlueprintDoc.tenant_id == tenant.id))
    doc = doc_result.scalar_one_or_none()
    if not doc:
        doc = BlueprintDoc(tenant_id=tenant.id, title="Bokito Blueprint")
        session.add(doc)
        await session.flush()
        overview = BlueprintPage(
            doc_id=doc.id, tenant_id=tenant.id, title="Platform Overview", slug="overview", kind="prd"
        )
        session.add(overview)
        await session.flush()
        block = BlueprintBlock(
            page_id=overview.id,
            tenant_id=tenant.id,
            block_type="paragraph",
            content_json=json.dumps(
                {
                    "text": [{"text": "Bokito AI OS platform overview."}],
                    "props": {},
                }
            ),
        )
        session.add(block)
        await session.flush()
        await upsert_index_chunk(session, tenant.id, "blueprint_block", str(block.id), overview.title, "Bokito AI OS")

    if not (
        await session.execute(select(EmailAccount).where(EmailAccount.tenant_id == tenant.id))
    ).scalar_one_or_none():
        session.add(EmailAccount(tenant_id=tenant.id, email_address="support@bokito.ai", provider="mock"))

    if not (await session.execute(select(McpServer).where(McpServer.tenant_id == tenant.id))).scalar_one_or_none():
        session.add(McpServer(tenant_id=tenant.id, name="mock-tools", server_url="mock://local", auth_json="{}"))

    await _seed_inbox_threads(session, tenant)
    await _seed_demo_project(session, tenant)


async def _seed_demo_project(session, tenant):
    result = await session.execute(select(Project).where(Project.tenant_id == tenant.id))
    if result.scalar_one_or_none():
        return
    po_result = await session.execute(
        select(Agent).where(Agent.tenant_id == tenant.id, Agent.role == "po")
    )
    po = po_result.scalar_one_or_none()
    if not po:
        po = Agent(
            tenant_id=tenant.id,
            name="Platform PO",
            role="po",
            slug="po",
            runtime_status="standby",
            system_prompt="You are the product owner for the Bokito platform demo project.",
        )
        session.add(po)
        await session.flush()
    project = Project(
        tenant_id=tenant.id,
        name="Bokito Platform",
        slug="bokito-platform",
        description="Demo project for local development.",
        autonomous_scope="Maintain and improve the Bokito AI OS platform for multichannel support and agent workflows.",
        github_repo_full_name="bokito/platform",
        github_default_branch="main",
        repo_source="github_oauth",
        repo_index_status="ready",
        po_agent_id=po.id,
    )
    session.add(project)
    await session.flush()
    session.add(ProjectOrchestration(tenant_id=tenant.id, project_id=project.id))
    await _seed_workforce_demo(session, tenant, project, po)


async def _seed_workforce_demo(session, tenant, project, po_agent):
    from app.models.agent import AgentRun
    from app.services.workforce_runtime import ensure_run_events

    msg_exists = await session.execute(
        select(WorkforceMessage).where(WorkforceMessage.tenant_id == tenant.id).limit(1)
    )
    if not msg_exists.scalar_one_or_none():
        thread_id = str(project.id)
        session.add(
            WorkforceMessage(
                tenant_id=tenant.id,
                thread_id=thread_id,
                project_id=project.id,
                subject="Goedkeuring: inbox routing rule",
                body="De agent stelt voor een nieuwe routing rule aan te maken voor high-priority e-mail.",
                message_type="decision_request",
                channel="workforce",
                status="awaiting_human",
                payload_json=json.dumps({"proposal_type": "routing_rule"}),
            )
        )
        session.add(
            WorkforceMessage(
                tenant_id=tenant.id,
                thread_id=f"{thread_id}-2",
                project_id=project.id,
                subject="Status: repository index gereed",
                body="De repository index voor bokito/platform is voltooid.",
                message_type="status_update",
                channel="workforce",
                status="done",
            )
        )

    run_exists = await session.execute(
        select(AgentRun).where(AgentRun.tenant_id == tenant.id, AgentRun.project_id == project.id).limit(1)
    )
    if not run_exists.scalar_one_or_none():
        completed = AgentRun(
            tenant_id=tenant.id,
            agent_id=po_agent.id,
            project_id=project.id,
            status="completed",
            trigger_type="seed",
            subject="PO wake: review platform backlog",
            tokens_input=240,
            tokens_output=120,
            completed_at=datetime.utcnow(),
        )
        session.add(completed)
        await session.flush()
        await ensure_run_events(session, completed)


async def _seed_inbox_threads(session, tenant):
    existing = await session.execute(select(InboxThread).where(InboxThread.tenant_id == tenant.id))
    if existing.first():
        return
    samples = [
        {
            "subject": "Vraag over facturatie",
            "name": "Sanne de Vries",
            "email": "sanne@klant.nl",
            "status": "open",
            "priority": "high",
            "channel": "email",
            "body": "Hoi, ik heb een vraag over mijn laatste factuur. Klopt het bedrag wel?",
        },
        {
            "subject": "Live chat: product demo",
            "name": "Website bezoeker",
            "email": "visitor@web",
            "status": "open",
            "priority": "normal",
            "channel": "customer_widget",
            "body": "Kan ik een demo krijgen van het platform?",
        },
        {
            "subject": "Bedankt voor de snelle hulp",
            "name": "Mark Jansen",
            "email": "mark@bedrijf.com",
            "status": "closed",
            "priority": "normal",
            "channel": "email",
            "body": "Top geregeld, bedankt!",
        },
    ]
    for sample in samples:
        thread = InboxThread(
            tenant_id=tenant.id,
            organisation_id=str(tenant.id),
            email_subject=sample["subject"],
            contact_name=sample["name"],
            contact_email=sample["email"],
            status=sample["status"],
            priority=sample["priority"],
            channel=sample["channel"],
            has_unread=sample["status"] == "open",
        )
        session.add(thread)
        await session.flush()
        session.add(
            InboxMessage(
                thread_id=thread.id,
                tenant_id=tenant.id,
                direction="inbound",
                from_address=sample["email"],
                to_addresses="support@bokito.ai",
                subject=sample["subject"],
                body_preview=sample["body"][:200],
                body_html=f"<p>{sample['body']}</p>",
            )
        )
        session.add(
            InboxEvent(
                thread_id=thread.id,
                tenant_id=tenant.id,
                event_type="thread_created",
                payload_json=json.dumps({"channel": sample["channel"]}),
            )
        )


if __name__ == "__main__":
    asyncio.run(seed())
