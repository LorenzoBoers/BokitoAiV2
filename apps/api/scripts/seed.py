"""Seed Bokito test tenant for local development and automated tests."""

import asyncio
import json
import sys
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select

from app.db.session import async_session_factory, init_db
from app.models.agent import Agent
from app.models.trigger import Trigger
from app.models.auth import Membership, Tenant, User
from app.models.channel import ChannelAccount, Contact
from app.models.inbox import InboxSettings
from app.models.integration import McpServer
from app.models.policy import AssistantPersona
from app.models.project import Project, ProjectOrchestration
from app.services.auth import hash_password
from app.services.personal_agents import get_or_create_personal_agent
from app.services.workspace import get_doc_by_path, upsert_doc
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
            await get_or_create_personal_agent(session, demo.id, demo_user, commit=False)

        await get_or_create_personal_agent(session, tenant.id, user, commit=False)
        await session.commit()
        print(f"Seeded tenant={tenant.slug} user={TEST_EMAIL} password={TEST_PASSWORD}")
        print(f"Staff={STAFF_EMAIL} demo={DEMO_EMAIL} password={DEMO_PASSWORD}")


DEFAULT_ORCHESTRATOR_SCOPES = [
    "platform:read",
    "platform:graph:edit",
    "platform:workstream:create",
    "platform:workstream:update",
    "platform:doc:write",
    "platform:edge:connect",
]


async def _seed_signals(session, tenant):
    from app.models.signal import Signal, SignalEvent, SignalMessage

    existing = await session.execute(select(Signal).where(Signal.tenant_id == tenant.id).limit(1))
    if existing.scalar_one_or_none():
        return

    account_result = await session.execute(
        select(ChannelAccount)
        .where(ChannelAccount.tenant_id == tenant.id, ChannelAccount.channel == "email")
        .limit(1)
    )
    email_account = account_result.scalar_one_or_none()

    samples = [
        {
            "subject": "Vraag over facturatie",
            "name": "Sanne de Vries",
            "email": "sanne@klant.nl",
            "company": "Klant B.V.",
            "title": "Finance manager",
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
            "channel": "widget",
            "body": "Kan ik een demo krijgen van het platform?",
        },
        {
            "subject": "Bedankt voor de snelle hulp",
            "name": "Mark Jansen",
            "email": "mark@bedrijf.com",
            "company": "Bedrijf & Co",
            "title": "Operations lead",
            "status": "closed",
            "priority": "normal",
            "channel": "email",
            "body": "Top geregeld, bedankt!",
            "outbound_reply": "Graag gedaan! Laat het weten als we nog iets kunnen doen.",
        },
        {
            "subject": "Vraag over onboarding",
            "name": "Prospect",
            "email": "prospect@example.com",
            "status": "open",
            "priority": "normal",
            "channel": "email",
            "body": "Hoe start ik met jullie platform?",
        },
    ]

    for sample in samples:
        contact_result = await session.execute(
            select(Contact).where(
                Contact.tenant_id == tenant.id,
                Contact.channel == sample["channel"],
                Contact.address == sample["email"],
            )
        )
        contact = contact_result.scalar_one_or_none()
        if not contact:
            contact = Contact(
                tenant_id=tenant.id,
                channel=sample["channel"],
                address=sample["email"],
                display_name=sample["name"],
                company=sample.get("company", ""),
                title=sample.get("title", ""),
                last_seen_at=datetime.utcnow(),
            )
            session.add(contact)
            await session.flush()
        sig = Signal(
            tenant_id=tenant.id,
            channel=sample["channel"],
            source=sample["channel"],
            subject=sample["subject"],
            contact_id=contact.id,
            contact_email=sample["email"],
            contact_name=sample["name"],
            priority=sample["priority"],
            status=sample["status"],
            has_unread=sample["status"] == "open",
            channel_account_id=email_account.id if email_account and sample["channel"] == "email" else None,
        )
        session.add(sig)
        await session.flush()
        session.add(
            SignalMessage(
                signal_id=sig.id,
                tenant_id=tenant.id,
                kind="user_message",
                direction="inbound",
                body_text=sample["body"],
                body_preview=sample["body"][:200],
                from_address=sample["email"],
                subject=sample["subject"],
            )
        )
        if sample.get("outbound_reply"):
            session.add(
                SignalMessage(
                    signal_id=sig.id,
                    tenant_id=tenant.id,
                    kind="agent_message",
                    direction="outbound",
                    body_text=sample["outbound_reply"],
                    body_preview=sample["outbound_reply"][:200],
                    subject=f"Re: {sample['subject']}",
                )
            )
        session.add(SignalEvent(signal_id=sig.id, tenant_id=tenant.id, event_type="signal_created"))


async def _ensure_orchestrator_passport(session, tenant):
    result = await session.execute(
        select(Agent).where(Agent.tenant_id == tenant.id, Agent.role == "orchestrator")
    )
    for agent in result.scalars().all():
        if not json.loads(agent.permission_scopes_json or "[]"):
            agent.permission_scopes_json = json.dumps(DEFAULT_ORCHESTRATOR_SCOPES)


async def _seed_tenant_data(session, tenant):
    agent_result = await session.execute(
        select(Agent).where(Agent.tenant_id == tenant.id, Agent.role == "assistant")
    )
    if agent_result.scalars().first() is None:
        session.add(
            Agent(
                tenant_id=tenant.id,
                name="Bokito Assistant",
                role="assistant",
                slug="assistant",
                chat_access="everyone",
                runtime_status="standby",
                system_prompt="You are the Bokito AI OS assistant.",
            )
        )
        session.add(
            Agent(
                tenant_id=tenant.id,
                name="Bokito Platform Orchestrator",
                role="orchestrator",
                slug="orchestrator",
                runtime_status="standby",
                system_prompt="You are the orchestrator for the Bokito platform project. Plan work, route agents, and keep project knowledge current.",
            )
        )

    if not (
        await session.execute(select(InboxSettings).where(InboxSettings.tenant_id == tenant.id))
    ).scalar_one_or_none():
        session.add(InboxSettings(tenant_id=tenant.id))
        session.add(AssistantPersona(tenant_id=tenant.id, tone="Professional"))

    if not await get_doc_by_path(session, tenant.id, "company.md"):
        await upsert_doc(
            session,
            tenant.id,
            path="company.md",
            content="# Company\n\nBokito AI OS platform overview.\n",
            kind="doc",
            created_by_type="system",
            commit=False,
        )

    if not (
        await session.execute(
            select(ChannelAccount).where(
                ChannelAccount.tenant_id == tenant.id, ChannelAccount.channel == "email"
            )
        )
    ).scalar_one_or_none():
        session.add(
            ChannelAccount(
                tenant_id=tenant.id, channel="email", address="support@bokito.ai", provider="mock"
            )
        )

    if not (await session.execute(select(McpServer).where(McpServer.tenant_id == tenant.id))).scalar_one_or_none():
        session.add(McpServer(tenant_id=tenant.id, name="mock-tools", server_url="mock://local", auth_json="{}"))

    await _seed_signals(session, tenant)
    await _ensure_orchestrator_passport(session, tenant)
    await _seed_triggers(session, tenant)
    await _seed_demo_project(session, tenant)


async def _seed_triggers(session, tenant):
    existing = await session.execute(
        select(Trigger).where(Trigger.tenant_id == tenant.id).limit(1)
    )
    if existing.scalar_one_or_none():
        return

    now = datetime.utcnow()
    session.add(
        Trigger(
            tenant_id=tenant.id,
            name="Heartbeat",
            kind="heartbeat",
            interval_minutes=30,
            agent_role="assistant",
            enabled=False,
        )
    )
    session.add(
        Trigger(
            tenant_id=tenant.id,
            name="Daily platform scan",
            kind="interval",
            interval_minutes=1440,
            agent_role="orchestrator",
            instructions="Scan workspace docs and suggest improvements or missing integrations.",
            enabled=True,
            next_run_at=now + timedelta(days=1),
        )
    )


async def _seed_demo_project(session, tenant):
    result = await session.execute(select(Project).where(Project.tenant_id == tenant.id))
    if result.scalar_one_or_none():
        return
    po_result = await session.execute(
        select(Agent).where(
            Agent.tenant_id == tenant.id, Agent.role.in_(("orchestrator", "po"))
        )
    )
    po = po_result.scalars().first()
    if not po:
        po = Agent(
            tenant_id=tenant.id,
            name="Bokito Platform Orchestrator",
            role="orchestrator",
            slug="orchestrator",
            runtime_status="standby",
            system_prompt="You are the orchestrator for the Bokito platform project. Plan work, route agents, and keep project knowledge current.",
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
    from app.models.notification import DecisionRequest, Notification
    from app.services.workforce_runtime import ensure_run_events

    dec_exists = await session.execute(
        select(DecisionRequest).where(DecisionRequest.tenant_id == tenant.id).limit(1)
    )
    if not dec_exists.scalar_one_or_none():
        notification = Notification(
            tenant_id=tenant.id,
            kind="decision_request",
            title="Goedkeuring: inbox routing rule",
            body="De agent stelt voor een nieuwe routing rule aan te maken voor high-priority e-mail.",
            payload_json=json.dumps({"proposal_type": "routing_rule"}),
        )
        session.add(notification)
        await session.flush()
        decision = DecisionRequest(
            tenant_id=tenant.id,
            notification_id=notification.id,
            project_id=project.id,
            title="Goedkeuring: inbox routing rule",
            summary="De agent stelt voor een nieuwe routing rule aan te maken voor high-priority e-mail.",
            status="awaiting_human",
            options_json=json.dumps(
                [
                    {
                        "id": "approve",
                        "label": "Approve",
                        "action_type": "create_task",
                        "payload": {"title": "Apply routing rule", "project_id": str(project.id)},
                    },
                    {"id": "reject", "label": "Reject", "action_type": "reject"},
                ]
            ),
        )
        session.add(decision)
        await session.flush()
        from app.services.signal_decisions import ingest_decision_request

        await ingest_decision_request(session, tenant.id, notification, decision, agent_id=po_agent.id)

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


if __name__ == "__main__":
    asyncio.run(seed())
