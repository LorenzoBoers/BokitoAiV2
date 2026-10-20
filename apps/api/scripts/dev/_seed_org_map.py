"""Fill the Bokito dev tenant for the org map under the All-root model.

Idempotent. Touches only tenant slug ``bokito``. Does not create conversations.

Creates/keeps custom departments under All (Development, Support, HR), installs
Accounting so Boekito and shipped items hang on that department, and stamps
home ``department_id`` / access / routing so every card has edges.
"""
from __future__ import annotations

import asyncio
import json
from datetime import datetime
from uuid import UUID

from sqlalchemy import delete, select

from app.db.session import async_session_factory
from app.models.agent import Agent
from app.models.auth import Tenant, User
from app.models.calendar import CalendarTagLink, TenantCalendar
from app.models.channel import ChannelAccount
from app.models.integration import IntegrationConnection
from app.models.module_agent import AgentScope
from app.models.module_source import ModuleSource
from app.models.orchestra import Workstream
from app.models.project import Project, ProjectTagLink
from app.models.project_work import ProjectResource
from app.models.signal import SignalTag
from app.models.team import TEAM_KIND_CUSTOM, Department, DepartmentMember, is_root_department
from app.models.workspace import WorkspaceDoc
from app.services.calendar_access import set_calendar_access
from app.services.channel_access import set_account_access
from app.services.connection_access import set_connection_access
from app.services.teams import ensure_all_department
from app.services.tickets import DEFAULT_TICKET_STAGES


def _stages(raw: str, owners: dict[str, dict[str, str]]) -> str:
    try:
        stages = json.loads(raw or "[]")
    except json.JSONDecodeError:
        stages = []
    if not isinstance(stages, list) or not stages:
        stages = [dict(stage) for stage in DEFAULT_TICKET_STAGES]
    for stage in stages:
        if not isinstance(stage, dict):
            continue
        owner = owners.get(str(stage.get("key") or ""))
        if owner:
            stage["owner"] = owner
    return json.dumps(stages)


async def _ensure_department(
    session,
    tenant_id: UUID,
    *,
    name: str,
    description: str,
    parent_id: UUID,
    pickup: str = "people",
) -> Department:
    row = (
        await session.execute(
            select(Department).where(
                Department.tenant_id == tenant_id,
                Department.name == name,
                Department.deleted_at.is_(None),
            )
        )
    ).scalars().first()
    if row is None:
        row = Department(
            tenant_id=tenant_id,
            name=name,
            description=description,
            kind=TEAM_KIND_CUSTOM,
            pickup=pickup,
            pinned=True,
            parent_id=parent_id,
        )
        session.add(row)
        await session.flush()
        print("created department", name)
    else:
        if row.parent_id is None and not is_root_department(row):
            row.parent_id = parent_id
            session.add(row)
            print("reparented", name, "under All")
    return row


async def _ensure_member(
    session,
    tenant_id,
    department_id,
    kind,
    user_id=None,
    agent_id=None,
    duty="member",
):
    existing = (
        await session.execute(
            select(DepartmentMember).where(
                DepartmentMember.department_id == department_id,
                DepartmentMember.member_kind == kind,
                DepartmentMember.user_id == user_id,
                DepartmentMember.agent_id == agent_id,
            )
        )
    ).scalars().first()
    if existing:
        if existing.duty != duty and duty == "primary":
            existing.duty = duty
            session.add(existing)
        return
    position = int(
        (
            await session.execute(
                select(DepartmentMember.position)
                .where(DepartmentMember.department_id == department_id)
                .order_by(DepartmentMember.position.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        or -1
    ) + 1
    session.add(
        DepartmentMember(
            tenant_id=tenant_id,
            department_id=department_id,
            member_kind=kind,
            user_id=user_id,
            agent_id=agent_id,
            duty=duty,
            position=position,
        )
    )


async def _scope(session, tenant_id, agent_id, kind, resource_id):
    existing = (
        await session.execute(
            select(AgentScope).where(
                AgentScope.tenant_id == tenant_id,
                AgentScope.agent_id == agent_id,
                AgentScope.resource_kind == kind,
                AgentScope.resource_id == resource_id,
            )
        )
    ).scalars().first()
    if existing:
        return
    session.add(
        AgentScope(
            tenant_id=tenant_id,
            agent_id=agent_id,
            resource_kind=kind,
            resource_id=resource_id,
            can_write=True,
        )
    )


async def main() -> None:
    async with async_session_factory() as session:
        tenant = (
            await session.execute(select(Tenant).where(Tenant.slug == "bokito"))
        ).scalars().first()
        if tenant is None:
            raise SystemExit("bokito tenant missing")
        tid = tenant.id
        root = await ensure_all_department(session, tid)
        print("All root", root.id)

        def one(model, *where):
            return session.execute(select(model).where(model.tenant_id == tid, *where))

        agents = {row.name: row for row in (await one(Agent)).scalars()}
        folders = {
            row.name: row
            for row in (await one(Project, Project.deleted_at.is_(None))).scalars()
        }
        flows = {
            row.name: row
            for row in (await one(Workstream, Workstream.deleted_at.is_(None))).scalars()
        }
        channels = {
            row.display_name or row.address: row
            for row in (await one(ChannelAccount)).scalars()
        }
        calendars = {row.name: row for row in (await one(TenantCalendar)).scalars()}
        connections = {
            row.provider: row for row in (await one(IntegrationConnection)).scalars()
        }
        docs = list((await one(WorkspaceDoc)).scalars())

        root_id = root.id
        support = await _ensure_department(
            session,
            tid,
            name="Support",
            description="Customer conversations and the front desk.",
            parent_id=root_id,
            pickup="people",
        )
        development = await _ensure_department(
            session,
            tid,
            name="Development",
            description="Builds the product. Owns bugs and features.",
            parent_id=root_id,
            pickup="agent_first",
        )
        hr = await _ensure_department(
            session,
            tid,
            name="HR",
            description="People ops and internal requests.",
            parent_id=root_id,
            pickup="people",
        )
        support_id, development_id, hr_id = support.id, development.id, hr.id

        person = (
            await session.execute(
                select(User)
                .join(DepartmentMember, DepartmentMember.user_id == User.id)
                .where(
                    DepartmentMember.department_id == support.id,
                    DepartmentMember.member_kind == "user",
                )
            )
        ).scalars().first()
        if person is None:
            person = (
                await session.execute(
                    select(User)
                    .join(DepartmentMember, DepartmentMember.user_id == User.id)
                    .where(
                        DepartmentMember.tenant_id == tid,
                        DepartmentMember.member_kind == "user",
                    )
                )
            ).scalars().first()
        if person is None:
            raise SystemExit("No person found to place on departments")
        person_id = person.id

        await _ensure_member(session, tid, support_id, "user", user_id=person_id, duty="primary")
        await _ensure_member(session, tid, development_id, "user", user_id=person_id, duty="primary")
        await _ensure_member(session, tid, hr_id, "user", user_id=person_id, duty="primary")

        orchestrator = agents.get("Orchestrator")
        assistant = agents.get("Bokito")
        if orchestrator and orchestrator.is_active:
            await _ensure_member(
                session, tid, development.id, "agent", agent_id=orchestrator.id, duty="primary"
            )
        if assistant and assistant.is_active:
            await _ensure_member(
                session, tid, support.id, "agent", agent_id=assistant.id, duty="primary"
            )

        # Accounting module: one-time drop (department + Boekito + shipped items).
        from app.modules.catalog import install_module
        from app.services.module_origin import module_is_installed

        if not await module_is_installed(session, tid, "accounting"):
            await install_module(session, tid, "accounting", hire_specialist=True)
            print("accounting installed")
        else:
            print("accounting already installed")

        session.expire_all()
        agents = {row.name: row for row in (await one(Agent)).scalars()}
        folders = {
            row.name: row
            for row in (await one(Project, Project.deleted_at.is_(None))).scalars()
        }
        channels = {
            row.display_name or row.address: row
            for row in (await one(ChannelAccount)).scalars()
        }
        calendars = {row.name: row for row in (await one(TenantCalendar)).scalars()}
        connections = {
            row.provider: row for row in (await one(IntegrationConnection)).scalars()
        }
        docs = list((await one(WorkspaceDoc)).scalars())
        orchestrator = agents.get("Orchestrator")
        assistant = agents.get("Bokito")
        boekito = agents.get("Boekhouder") or agents.get("Boekito")
        accounting = (
            await session.execute(
                select(Department).where(
                    Department.tenant_id == tid,
                    Department.origin_module_slug == "accounting",
                    Department.deleted_at.is_(None),
                )
            )
        ).scalars().first()
        accounting_id = accounting.id if accounting else None
        if accounting_id:
            print("Accounting department", accounting_id)
            if boekito and boekito.is_active:
                await _ensure_member(
                    session,
                    tid,
                    accounting_id,
                    "agent",
                    agent_id=boekito.id,
                    duty="primary",
                )
                print("Boekito on Accounting")

        # Stamp home department on folders.
        for name, dept_id, dept_name in (
            ("Development", development_id, "Development"),
            ("bokito platform", development_id, "Development"),
            ("administratie", accounting_id or development_id, "Accounting" if accounting_id else "Development"),
        ):
            folder = folders.get(name)
            if folder is None:
                continue
            folder.department_id = dept_id
            session.add(folder)
            print("folder home", name, "->", dept_name)

        # Flows / labels.
        flows = {
            row.name: row
            for row in (await one(Workstream, Workstream.deleted_at.is_(None))).scalars()
        }
        for name, dept_id in (
            ("Support", support_id),
            ("bug", development_id),
            ("feature", development_id),
            ("VAT filing preparation", accounting_id),
            ("Monthly close review", accounting_id),
        ):
            if dept_id is None:
                continue
            flow = flows.get(name)
            if flow is None:
                continue
            flow.department_id = dept_id
            session.add(flow)
            print("flow home", name)

        for tag in (await one(SignalTag)).scalars():
            if tag.name == "factuurvraag" and accounting_id:
                tag.department_id = accounting_id
                session.add(tag)
            elif tag.workstream_id:
                flow = next((f for f in flows.values() if f.id == tag.workstream_id), None)
                if flow and flow.department_id:
                    tag.department_id = flow.department_id
                    session.add(tag)

        dept_ref = lambda department_id: {"kind": "department", "id": str(department_id)}
        agent_owner = lambda row: {"kind": "agent", "id": str(row.id)}
        flow_owners = {
            "Support": (
                {"open": dept_ref(support_id), "waiting": agent_owner(assistant)}
                if assistant
                else {"open": dept_ref(support_id)}
            ),
            "bug": {
                "open": dept_ref(development_id),
                **({"waiting": agent_owner(orchestrator)} if orchestrator else {}),
            },
            "feature": {"open": dept_ref(development_id)},
        }
        for name, owners in flow_owners.items():
            flow = flows.get(name)
            if flow is None:
                continue
            flow.stages_json = _stages(flow.stages_json, owners)
            flow.updated_at = datetime.utcnow()
            session.add(flow)
            print("stage owners", name)

        live_flow_ids = {row.id for row in flows.values()}
        for tag in (await one(SignalTag)).scalars():
            if tag.workstream_id and tag.workstream_id not in live_flow_ids:
                tag.workstream_id = None
                session.add(tag)
                print("cleared dangling label", tag.name)

        deleted_folders = list(
            (
                await session.execute(
                    select(Project.id).where(
                        Project.tenant_id == tid, Project.deleted_at.is_not(None)
                    )
                )
            ).scalars()
        )
        if deleted_folders:
            await session.execute(
                delete(ProjectTagLink).where(ProjectTagLink.project_id.in_(deleted_folders))
            )
            print("removed label rules on deleted folders", len(deleted_folders))

        def route(account: ChannelAccount, department_id, agent_id=None):
            try:
                settings = json.loads(account.settings_json or "{}")
            except json.JSONDecodeError:
                settings = {}
            if not isinstance(settings, dict):
                settings = {}
            routing = settings.get("routing") if isinstance(settings.get("routing"), dict) else {}
            routing.pop("user_id", None)
            routing["department_id"] = str(department_id)
            settings["routing"] = routing
            account.settings_json = json.dumps(settings)
            account.routing_department_id = department_id
            if agent_id:
                account.default_agent_id = agent_id
            session.add(account)

        widget = channels.get("Website chat")
        support_mail = channels.get("Support")
        if widget:
            route(widget, support_id, assistant.id if assistant else None)
            await set_account_access(
                session,
                widget,
                [{"kind": "department", "id": str(support_id), "level": "handle"}],
            )
            print("routed Website chat")
        if support_mail:
            route(support_mail, support_id, assistant.id if assistant else None)
            await set_account_access(
                session,
                support_mail,
                [{"kind": "department", "id": str(support_id), "level": "handle"}],
            )
            print("routed Support mailbox")
        personal = channels.get("lorenzo@bokito.ai")
        if personal:
            await set_account_access(
                session, personal, [{"kind": "user", "id": str(person_id), "level": "handle"}]
            )
            print("kept personal mailbox on its person")

        holidays = (
            await session.execute(
                select(SignalTag).where(SignalTag.tenant_id == tid, SignalTag.name == "holidays")
            )
        ).scalars().first()
        if holidays is None:
            holidays = SignalTag(
                tenant_id=tid, name="holidays", description="Company and public holidays."
            )
            session.add(holidays)
            await session.flush()
            print("created label holidays")
        holidays.department_id = hr_id
        session.add(holidays)
        for name in ("Feestdagen in Nederland", "Holidays in Netherlands"):
            calendar = calendars.get(name)
            if calendar is None:
                continue
            calendar.department_id = hr_id
            session.add(calendar)
            await set_calendar_access(
                session, calendar, [{"kind": "department", "id": str(hr_id), "level": "use"}]
            )
            link = (
                await session.execute(
                    select(CalendarTagLink).where(
                        CalendarTagLink.calendar_id == calendar.id,
                        CalendarTagLink.tag_id == holidays.id,
                    )
                )
            ).scalars().first()
            if link is None:
                session.add(
                    CalendarTagLink(calendar_id=calendar.id, tag_id=holidays.id, tenant_id=tid)
                )
            print("calendar", name)

        google = connections.get("google_calendar")
        mcp = connections.get("custom_mcp")
        if google:
            google.department_id = hr_id
            session.add(google)
            await set_connection_access(
                session, google, [{"kind": "department", "id": str(hr_id), "level": "use"}]
            )
            print("google calendar access")
        if mcp:
            mcp.department_id = development_id
            session.add(mcp)
            await set_connection_access(
                session,
                mcp,
                [{"kind": "department", "id": str(development_id), "level": "use"}],
            )
            folder = folders.get("Development")
            if folder:
                existing = (
                    await session.execute(
                        select(ProjectResource).where(
                            ProjectResource.tenant_id == tid,
                            ProjectResource.project_id == folder.id,
                            ProjectResource.connection_id == mcp.id,
                            ProjectResource.deleted_at.is_(None),
                        )
                    )
                ).scalars().first()
                if existing is None:
                    session.add(
                        ProjectResource(
                            tenant_id=tid,
                            project_id=folder.id,
                            resource_type="connection",
                            provider="custom_mcp",
                            connection_id=mcp.id,
                            label=mcp.display_name or "mock-tools",
                            status="connected",
                        )
                    )
                print("wired mcp to Development")

        # Folders share the flow lane via the action tag on their filterset.
        label_links = (
            ("Development", "bug"),
            ("Development", "feature"),
            ("bokito platform", "feature"),
        )
        for folder_name, flow_name in label_links:
            folder = folders.get(folder_name)
            flow = flows.get(flow_name)
            if not folder or not flow:
                continue
            tag = (
                await session.execute(
                    select(SignalTag).where(
                        SignalTag.tenant_id == tid,
                        SignalTag.workstream_id == flow.id,
                    )
                )
            ).scalars().first()
            if tag is None:
                continue
            existing = (
                await session.execute(
                    select(ProjectTagLink).where(
                        ProjectTagLink.project_id == folder.id,
                        ProjectTagLink.tag_id == tag.id,
                    )
                )
            ).scalars().first()
            if existing is None:
                session.add(
                    ProjectTagLink(
                        project_id=folder.id,
                        tag_id=tag.id,
                        tenant_id=tid,
                    )
                )
                print("linked label", folder_name, flow_name, tag.name)

        if assistant:
            if widget:
                await _scope(session, tid, assistant.id, "channel", str(widget.id))
            if support_mail:
                await _scope(session, tid, assistant.id, "channel", str(support_mail.id))
        if orchestrator and folders.get("Development"):
            await _scope(session, tid, orchestrator.id, "project", str(folders["Development"].id))

        about = next((doc for doc in docs if doc.title == "About the company"), None)
        if about and folders.get("bokito platform"):
            about.project_id = folders["bokito platform"].id
            about.department_id = development_id
            about.agent_id = None
            session.add(about)
            print("filed About the company on Development")

        admin = folders.get("administratie")
        accounting_titles = {
            "RJNet — Richtlijnen voor de Jaarverslaggeving",
            "Belastingdienst",
            "NBA — Handleiding Regelgeving Accountancy (HRA)",
            "wetten.nl — BW2 Titel 9 Jaarrekening",
            "KvK",
        }
        home_dept = accounting_id or development_id
        if admin:
            for doc in docs:
                if doc.title in accounting_titles:
                    doc.project_id = admin.id
                    doc.department_id = home_dept
                    doc.agent_id = None
                    session.add(doc)
            print("filed accounting docs on", "Accounting" if accounting_id else "Development")

        for source in (await one(ModuleSource)).scalars():
            if source.module_slug == "accounting" and accounting_id:
                source.department_id = accounting_id
                session.add(source)
            match = next((doc for doc in docs if doc.title and doc.title == source.title), None)
            if match and source.workspace_doc_id != match.id:
                source.workspace_doc_id = match.id
                session.add(source)
                print("source doc", source.title)
            if match and source.department_id:
                match.department_id = source.department_id
                match.agent_id = None
                session.add(match)

        skill = (
            await session.execute(
                select(WorkspaceDoc).where(
                    WorkspaceDoc.tenant_id == tid,
                    WorkspaceDoc.path == "modules/accounting/skill.md",
                )
            )
        ).scalars().first()
        if skill and accounting_id:
            skill.department_id = accounting_id
            skill.agent_id = None
            session.add(skill)
            print("accounting skill on department")

        await session.commit()

        # Summary
        depts = (
            await session.execute(
                select(Department).where(
                    Department.tenant_id == tid, Department.deleted_at.is_(None)
                )
            )
        ).scalars().all()
        print("---")
        for d in sorted(depts, key=lambda r: (0 if is_root_department(r) else 1, r.name.lower())):
            members = (
                await session.execute(
                    select(DepartmentMember).where(DepartmentMember.department_id == d.id)
                )
            ).scalars().all()
            parent = "All" if d.parent_id == root_id else ("-" if d.parent_id is None else str(d.parent_id)[:8])
            print(f"{d.name}: parent={parent} members={len(members)}")
        print("committed")


if __name__ == "__main__":
    asyncio.run(main())
