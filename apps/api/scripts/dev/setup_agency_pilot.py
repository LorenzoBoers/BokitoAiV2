"""Set up an agency workspace (the Lots Of Content pilot) on dev. Idempotent per tenant slug.

Creates, or brings up to date:
- the workspace (Dutch, posture Assisted) with the owner as member;
- domains Klantwerk, Content and Research with their lead agents;
- agents Projectleider, Klantcontact, Content and Research;
- flows #onboarding, #maandcontent, #shoot, #rapportage and #vraag (direct), each a recipe;
- folders Klanten/{naam} with the client docs Profiel, Tone of voice, Contentpijlers,
  Afspraken and Geplaatst (templates), plus Lots intern;
- a Monday briefing and the monthly content tickets on the Agenda;
- with --demo, a few sample conversations so the inbox and boards are not empty.

Client names are arguments; the defaults are fictional. No client data lives in git.

    python scripts/dev/setup_agency_pilot.py --owner-email you@example.com \
        --slug lotsofcontent --name "Lots Of Content" --clients "Bakkerij Korenaar,Fysio Nijkerk" --demo
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import UUID

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from sqlalchemy import select  # noqa: E402

from app.db.session import async_session_factory  # noqa: E402
from app.models.agent import Agent  # noqa: E402
from app.models.auth import Membership, Tenant, User  # noqa: E402
from app.models.orchestra import Workstream  # noqa: E402
from app.models.project import Project  # noqa: E402
from app.models.signal import Signal, SignalEvent, SignalMessage, SignalTag  # noqa: E402
from app.models.team import Department  # noqa: E402
from app.models.trigger import Trigger  # noqa: E402

DEFAULT_CLIENTS = ("Bakkerij De Korenaar", "Fysio Nijkerk", "Studio Veluwe")

AGENTS: dict[str, dict[str, Any]] = {
    "Projectleider": {
        "job_title": "Projectleider",
        "description": "Houdt de stand per klant bij, signaleert achterstand en verdeelt het werk.",
        "prompt": (
            "Je bent de projectleider van een social media bureau. Je bewaakt per klant de flows "
            "(onboarding, maandcontent, shoot, rapportage), ziet wat over de deadline is, wat op de "
            "klant wacht en wat ontbreekt, en maakt daar taken of vragen van. Je schrijft kort en "
            "concreet in het Nederlands. Je verstuurt nooit zelf iets naar een klant."
        ),
        "tools": [
            "list_threads", "get_ticket", "update_ticket", "file_ticket", "list_flows", "list_folders",
            "list_folder_docs", "read_doc", "write_doc", "post_internal_note", "create_task",
            "assign_conversation", "set_thread_schedule", "search_index",
        ],
    },
    "Klantcontact": {
        "job_title": "Klantcontact",
        "description": "Beantwoordt klantmail in de stijl van het bureau, vat samen en herinnert.",
        "prompt": (
            "Je beantwoordt mail van klanten van een social media bureau. Lees eerst de map van de "
            "klant: profiel, tone of voice en afspraken. Schrijf warm, kort en persoonlijk, in de stijl "
            "van eerdere antwoorden. Een concept gaat altijd eerst langs een collega. Vaste feedback "
            "van de klant leg je vast in het doc Afspraken."
        ),
        "tools": [
            "send_reply", "suggest_thread_reply", "post_internal_note", "record_thread_read", "read_doc",
            "list_folder_docs", "write_doc", "schedule_wake", "file_ticket", "search_index",
        ],
    },
    "Content": {
        "job_title": "Contentmaker",
        "description": "Bedenkt ideeen, schrijft captions en kanaalvarianten en maakt draaiboeken.",
        "prompt": (
            "Je maakt social content voor klanten van het bureau. Je leest altijd eerst de map van de "
            "klant (profiel, tone of voice, contentpijlers, geplaatst) zodat niets herhaalt en alles "
            "op toon is. Per post lever je een idee, een caption en een variant per kanaal. Voor een "
            "shoot maak je een draaiboek: hooks, script, shotlist, mensen, locatie en materiaal."
        ),
        "tools": [
            "read_doc", "list_folder_docs", "write_doc", "post_internal_note", "create_queue_item",
            "list_queue_items", "update_queue_item_status", "generate_image", "web_search", "search_index",
        ],
    },
    "Research": {
        "job_title": "Researcher",
        "description": "Zoekt trends, doet doelgroep- en concurrentieonderzoek en analyseert cijfers.",
        "prompt": (
            "Je doet onderzoek voor een social media bureau: trends, concurrentie, doelgroep, hashtags "
            "en de cijfers van de kanalen. Je noemt altijd je bronnen met een link. Je vertelt per "
            "klant voor wie iets relevant is, waarom, en hoe het bureau het kan inzetten."
        ),
        "tools": [
            "web_search", "fetch_url", "read_doc", "list_folder_docs", "write_doc", "post_internal_note",
            "search_index", "post_trend",
        ],
    },
}

DOMAINS: list[dict[str, Any]] = [
    {"name": "Klantwerk", "description": "Klantcontact, planning en de stand per klant.", "lead": "Projectleider",
     "agents": ["Projectleider", "Klantcontact"], "owner_primary": True},
    {"name": "Content", "description": "Ideeen, captions, shoots en de contentkalender.", "lead": "Content",
     "agents": ["Content"], "owner_primary": False},
    {"name": "Research", "description": "Trends, onderzoek en rapportage.", "lead": "Research",
     "agents": ["Research"], "owner_primary": False, "lens": "outward"},
]


def _stage(name: str, kind: str, *, waiting_on: str = "", checklist: list[str] | None = None,
           checkup_days: int = 0, fields: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    return {
        "name": name,
        "kind": kind,
        "waiting_on": waiting_on,
        "checkup_minutes": checkup_days * 24 * 60,
        "checklist": [{"label": item} for item in (checklist or [])],
        "fields": fields or [],
    }


# The estimate per ticket; the orientation sums it per person against hours_per_week.
HOURS_FIELD = {"key": "hours", "name": "Uren", "type": "number"}

FLOWS: list[dict[str, Any]] = [
    {
        "label": "onboarding",
        "title": "Onboarding",
        "description": "Een nieuwe klant: van kick-off tot akkoord op de strategie.",
        "domain": "Klantwerk",
        "autonomy": "",
        "stages": [
            _stage("Kick-off", "open", checklist=["Pakket vastgelegd", "Kanalen en toegang ontvangen"]),
            _stage("Profiel", "waiting", waiting_on="us", checklist=["Profiel ingevuld", "Tone of voice ingevuld"]),
            _stage("Onderzoek", "waiting", waiting_on="us", checklist=["Concurrenten", "Doelgroep", "Hashtags"]),
            _stage("Voorstel", "waiting", waiting_on="customer", checkup_days=3),
            _stage("Akkoord", "done"),
        ],
        "instructions": (
            "Vul de docs Profiel, Tone of voice en Contentpijlers in de map van de klant. Doe concurrentie-, "
            "doelgroep- en hashtagonderzoek met bronnen. Wat ontbreekt, vraag je aan de klant in een "
            "concept. Sluit af met een strategievoorstel."
        ),
        "expected_outcome": "Profiel, tone of voice en contentpijlers staan in de map en de klant is akkoord",
    },
    {
        "label": "maandcontent",
        "title": "Maandcontent",
        "description": "De posts van een klant voor een maand: van idee tot ingepland.",
        "domain": "Content",
        "autonomy": "autonomous",
        "stages": [
            _stage("Ideeen", "open", fields=[HOURS_FIELD]),
            _stage("Selectie", "waiting", waiting_on="us", checklist=["Selectie door Lot"]),
            _stage("Captions", "waiting", waiting_on="us", checklist=["Captions per kanaal"]),
            _stage("Klant akkoord", "waiting", waiting_on="customer", checkup_days=4),
            _stage("Ingepland", "done"),
        ],
        "instructions": (
            "Lees profiel, contentpijlers en geplaatst. Maak per post een idee, een caption en een variant "
            "per kanaal, passend bij het pakket van de klant. Zet de posts als items in de map met datum, "
            "kanaal, caption en beeld. Publiceren doet een mens."
        ),
        "expected_outcome": "De posts van de maand staan ingepland en in het doc Geplaatst",
    },
    {
        "label": "shoot",
        "title": "Shoot",
        "description": "Foto of video: concept, draaiboek, opname en montage.",
        "domain": "Content",
        "autonomy": "",
        "stages": [
            _stage("Concept", "open", fields=[HOURS_FIELD]),
            _stage("Draaiboek", "waiting", waiting_on="us",
                   checklist=["Hooks", "Script", "Shotlist", "Mensen en locatie", "Materiaal"]),
            _stage("Gepland", "waiting", waiting_on="customer"),
            _stage("Opgenomen", "waiting", waiting_on="us"),
            _stage("Bewerkt", "done"),
        ],
        "instructions": (
            "Maak een draaiboek met hooks, script, shotlist, wie er meedoet, locatie en materiaal. "
            "Plan de shoot in de agenda en stuur de klant een bevestiging als concept."
        ),
        "expected_outcome": "Het bewerkte materiaal staat klaar in de map",
    },
    {
        "label": "rapportage",
        "title": "Rapportage",
        "description": "Maandelijkse evaluatie voor More- en Pro-klanten.",
        "domain": "Research",
        "autonomy": "",
        "stages": [
            _stage("Verzamelen", "open"),
            _stage("Analyse", "waiting", waiting_on="us", checklist=["Wat werkt", "Wat blijft achter", "Aanpassing"]),
            _stage("Deck", "waiting", waiting_on="us"),
            _stage("Besproken", "done"),
        ],
        "instructions": (
            "Verzamel de cijfers per kanaal over de periode. Schrijf wat werkt, wat achterblijft en wat je "
            "aanpast, met de cijfers erbij. Maak daarna het deck."
        ),
        "expected_outcome": "Het rapport is besproken met de klant",
    },
    {
        "label": "vraag",
        "title": "Vraag",
        "description": "Een vraag of kleine wijziging van een klant, direct afgehandeld.",
        "domain": "Klantwerk",
        "autonomy": "assisted",
        "stages": [_stage("Open", "open"), _stage("Afgehandeld", "done")],
        "instructions": (
            "Beantwoord de vraag in het gesprek met de kennis uit de map. Een kleine wijziging voer je "
            "meteen uit en je bevestigt die. Vaste feedback leg je vast in Afspraken."
        ),
        "expected_outcome": "De klant heeft antwoord",
    },
]

CLIENT_DOCS: list[tuple[str, str]] = [
    ("Profiel", "# Profiel\n\n## Bedrijf\n\n## Doelgroep\n\n## Diensten\n\n## Pakket\nBasic, More of Pro.\n\n## Kanalen\n"),
    ("Tone of voice", "# Tone of voice\n\n## Zo klinken we\n\n## Wel\n\n## Niet\n"),
    ("Contentpijlers", "# Contentpijlers\n\n1. \n2. \n3. \n"),
    ("Afspraken", "# Afspraken\n\nFeedback van de klant die altijd geldt.\n"),
    ("Geplaatst", "# Geplaatst\n\nWat al online staat, zodat niets herhaalt.\n"),
]

INTERN_DOCS: list[tuple[str, str]] = [
    ("Werkwijze", "# Werkwijze\n\nHoe het bureau werkt: pakketten, vaste stappen per klant per maand en wie wat doet.\n"),
    ("Huisstijl", "# Huisstijl\n\nKleuren, lettertypes en toon van het bureau zelf.\n"),
]


def _slug(value: str) -> str:
    from app.services.tickets import slugify

    return slugify(value)


async def _tenant(session, slug: str, name: str, owner: User) -> Tenant:
    from app.services.tenant_bootstrap import serialize_settings
    from app.services.workspaces_portal import create_workspace

    tenant = (await session.execute(select(Tenant).where(Tenant.slug == slug))).scalar_one_or_none()
    if tenant is None:
        await create_workspace(session, owner, name=name, subdomain=slug)
        tenant = (await session.execute(select(Tenant).where(Tenant.slug == slug))).scalar_one()
    member = (
        await session.execute(
            select(Membership).where(Membership.tenant_id == tenant.id, Membership.user_id == owner.id)
        )
    ).scalar_one_or_none()
    if member is None:
        session.add(Membership(tenant_id=tenant.id, user_id=owner.id, role="owner"))
    settings = json.loads(tenant.settings_json or "{}")
    settings.update({"ui_language": "nl", "ai_workspace_language": "nl", "timezone": "Europe/Amsterdam"})
    settings["autonomy_posture"] = "assisted"
    handling = settings.get("ai_handling") if isinstance(settings.get("ai_handling"), dict) else {}
    handling.update({"default": "assisted", "ceiling": "autonomous"})
    settings["ai_handling"] = handling
    onboarding = settings.get("onboarding") if isinstance(settings.get("onboarding"), dict) else {}
    onboarding.setdefault("intake", {"source": "partner", "org_size": "2-10", "use_case": "agency"})
    onboarding.setdefault("wizard_completed_at", datetime.utcnow().isoformat())
    settings["onboarding"] = onboarding
    tenant.settings_json = serialize_settings(settings)
    tenant.name = name
    session.add(tenant)
    await session.commit()
    return tenant


async def _agents(session, tenant: Tenant, owner: User) -> dict[str, Agent]:
    from app.services.workforce_runtime import create_agent

    out: dict[str, Agent] = {}
    for name, spec in AGENTS.items():
        agent = (
            await session.execute(select(Agent).where(Agent.tenant_id == tenant.id, Agent.name == name))
        ).scalar_one_or_none()
        if agent is None:
            await create_agent(
                session,
                tenant.id,
                name=name,
                job_title=spec["job_title"],
                description=spec["description"],
                system_prompt=spec["prompt"],
                tools=spec["tools"],
                owner_user_id=owner.id,
            )
            agent = (
                await session.execute(select(Agent).where(Agent.tenant_id == tenant.id, Agent.name == name))
            ).scalar_one()
        else:
            agent.description = spec["description"]
            agent.system_prompt = spec["prompt"]
            agent.tools_json = json.dumps(spec["tools"])
            agent.is_active = True
            session.add(agent)
        out[name] = agent
    await session.commit()
    return out


async def _domains(session, tenant: Tenant, owner: User, agents: dict[str, Agent]) -> dict[str, Department]:
    from app.services.teams import create_team, set_team_members
    from app.services.trends import set_department_lens

    out: dict[str, Department] = {}
    for spec in DOMAINS:
        dept = (
            await session.execute(
                select(Department).where(
                    Department.tenant_id == tenant.id,
                    Department.name == spec["name"],
                    Department.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if dept is None:
            dept = await create_team(session, tenant.id, name=spec["name"], description=spec["description"])
        members: list[dict[str, str]] = []
        for agent_name in spec["agents"]:
            duty = "primary" if agent_name == spec["lead"] else "member"
            members.append({"kind": "agent", "id": str(agents[agent_name].id), "duty": duty})
        members.append({"kind": "user", "id": str(owner.id), "duty": "primary" if spec["owner_primary"] else "member"})
        await set_team_members(session, dept, members)
        set_department_lens(dept, spec.get("lens", ""))
        session.add(dept)
        out[spec["name"]] = dept
    await session.commit()
    return out


async def _flows(session, tenant: Tenant, owner: User, domains: dict[str, Department]) -> dict[str, tuple[Workstream, SignalTag]]:
    from app.services.signal_tags import create_tag, promote_tag
    from app.services.tickets import validate_stages
    from app.services.workstreams import apply_recipe

    out: dict[str, tuple[Workstream, SignalTag]] = {}
    for spec in FLOWS:
        tag = await create_tag(session, tenant.id, spec["label"], description=spec["description"], user_id=owner.id)
        if tag.workstream_id is None:
            tag = await promote_tag(session, tenant.id, tag.id, playbook_name=spec["title"], user_id=owner.id)
        ws = await session.get(Workstream, tag.workstream_id)
        ws.name = spec["title"]
        ws.description = spec["description"]
        ws.department_id = domains[spec["domain"]].id
        ws.autonomy = spec["autonomy"]
        ws.stages_json = validate_stages(spec["stages"])
        await apply_recipe(
            session, ws, {"instructions": spec["instructions"], "expected_outcome": spec["expected_outcome"]}
        )
        ws.updated_at = datetime.utcnow()
        session.add(ws)
        out[spec["label"]] = (ws, tag)
    await session.commit()
    return out


async def _folder(session, tenant: Tenant, owner: User, name: str, *, parent: Project | None, label: str | None,
                  description: str = "") -> Project:
    from app.services.projects import create_project

    query = select(Project).where(Project.tenant_id == tenant.id, Project.name == name, Project.deleted_at.is_(None))
    query = query.where(Project.parent_id == (parent.id if parent else None)) if parent else query.where(
        Project.parent_id.is_(None)
    )
    row = (await session.execute(query)).scalars().first()
    if row is not None:
        return row
    created = await create_project(
        session,
        tenant.id,
        name=name,
        description=description,
        tags=[label] if label else None,
        parent_id=parent.id if parent else None,
        user_id=owner.id,
    )
    await session.commit()
    return await session.get(Project, UUID(str(created["id"])))


async def _docs(session, tenant: Tenant, folder: Project, docs: list[tuple[str, str]]) -> int:
    from app.services.workspace import get_doc_by_path, upsert_doc

    made = 0
    for index, (title, body) in enumerate(docs):
        path = f"folders/{folder.slug}/{_slug(title)}.md"
        if await get_doc_by_path(session, tenant.id, path) is not None:
            continue
        doc = await upsert_doc(
            session, tenant.id, path=path, content=body, title=title, project_id=folder.id,
            created_by_type="system", commit=False,
        )
        doc.sort_order = index
        doc.is_pinned = index < 3
        session.add(doc)
        made += 1
    await session.commit()
    return made


async def _demo_conversation(session, tenant: Tenant, *, key: str, subject: str, sender: str, email: str,
                             body: str, folder: Project, agent: Agent, flow: tuple[Workstream, SignalTag] | None,
                             stage_key: str | None, hours_ago: int) -> Signal:
    from app.services.tickets import file_ticket

    existing = (
        await session.execute(select(Signal).where(Signal.tenant_id == tenant.id, Signal.external_id == key))
    ).scalar_one_or_none()
    if existing is not None:
        return existing
    at = datetime.utcnow() - timedelta(hours=hours_ago)
    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        source="demo",
        external_id=key,
        subject=subject,
        contact_name=sender,
        contact_email=email,
        status="open",
        priority="normal",
        summary=body[:300],
        agent_id=agent.id,
        assignee_kind="agent",
        assignee_id=agent.id,
        project_id=folder.id,
        last_message_at=at,
        has_unread=True,
        created_at=at,
    )
    session.add(signal)
    await session.flush()
    session.add(
        SignalMessage(
            signal_id=signal.id, tenant_id=tenant.id, kind="user_message", direction="inbound",
            body_text=body, body_preview=body[:200], from_address=email, subject=subject, received_at=at,
        )
    )
    session.add(
        SignalEvent(signal_id=signal.id, tenant_id=tenant.id, event_type="signal_created", actor_type="system",
                    payload_json=json.dumps({"started_by": sender, "source": "demo"}))
    )
    await session.commit()
    if flow is not None:
        await file_ticket(
            session, tenant.id, signal_id=signal.id, tag_id=flow[1].id, project_id=folder.id,
            stage_key=stage_key, created_by_type="system", summary=subject,
        )
        await session.commit()
    return signal


async def run(args: argparse.Namespace) -> dict[str, Any]:
    async with async_session_factory() as session:
        owner = (await session.execute(select(User).where(User.email == args.owner_email))).scalar_one_or_none()
        if owner is None:
            raise SystemExit(f"User not found: {args.owner_email}")
        tenant = await _tenant(session, args.slug, args.name, owner)
        agents = await _agents(session, tenant, owner)
        domains = await _domains(session, tenant, owner, agents)
        flows = await _flows(session, tenant, owner, domains)

        clients_root = await _folder(session, tenant, owner, "Klanten", parent=None, label=None,
                                     description="Een map per klant met de vaste klantkennis.")
        intern = await _folder(session, tenant, owner, "Lots intern", parent=None, label="intern",
                               description="Eigen marketing, huisstijl en werkwijze.")
        docs_made = await _docs(session, tenant, intern, INTERN_DOCS)
        clients = [c.strip() for c in (args.clients or ",".join(DEFAULT_CLIENTS)).split(",") if c.strip()]
        folders: dict[str, Project] = {}
        for client in clients:
            folder = await _folder(session, tenant, owner, client, parent=clients_root, label=_slug(client),
                                   description=f"Klantkennis en werk voor {client}.")
            folders[client] = folder
            docs_made += await _docs(session, tenant, folder, CLIENT_DOCS)

        from app.services.awareness import ensure_orientations
        from app.services.recurring_tickets import upsert_recurring_ticket

        # Earlier versions used plain wakes for these; the orientation and the
        # recurring ticket replace them.
        legacy = ["Weekstart projectleider", *[f"Maandcontent {c}" for c in folders]]
        for row in (
            await session.execute(
                select(Trigger).where(
                    Trigger.tenant_id == tenant.id,
                    Trigger.name.in_(legacy),
                    Trigger.purpose == "",
                    Trigger.deleted_at.is_(None),
                )
            )
        ).scalars().all():
            row.enabled = False
            row.next_run_at = None
            row.deleted_at = datetime.utcnow()
            session.add(row)
        await session.commit()
        orientations = await ensure_orientations(session, tenant.id)
        await session.commit()
        for client, folder in folders.items():
            await upsert_recurring_ticket(
                session, tenant.id, flow=flows["maandcontent"][1].name, cron="0 7 1 * *",
                folder=str(folder.id), title=f"Maandcontent {client} {{maand}}", name=f"Maandcontent {client}",
                agent_id=agents["Content"].id, user_id=owner.id,
                instructions=(
                    f"Start de maandcontent voor {client}: lees de klantkennis in de map, zet drie tot vijf "
                    "ideeen voor deze maand in het gesprek en vul de velden van de eerste fase."
                ),
            )

        demo = 0
        if args.demo and clients:
            first, *rest = list(folders.items())
            second = rest[0] if rest else first
            third = rest[1] if len(rest) > 1 else second
            samples = [
                (f"demo:{tenant.slug}:vraag", "Kunnen jullie de openingstijden aanpassen?", "Marieke", "marieke@voorbeeld.nl",
                 "Hoi! Vanaf volgende week zijn we op maandag gesloten. Kunnen jullie dat in de bio en de "
                 "highlights aanpassen? Groetjes, Marieke", first[1], agents["Klantcontact"], flows["vraag"], None, 2),
                (f"demo:{tenant.slug}:maand", f"Maandcontent {first[0]}", first[0], "info@voorbeeld.nl",
                 "Ideeen voor deze maand: seizoensproduct, achter de schermen bij de ochtendploeg, en een klantverhaal.",
                 first[1], agents["Content"], flows["maandcontent"], "captions", 30),
                (f"demo:{tenant.slug}:akkoord", f"Posts {second[0]} ter goedkeuring", second[0], "praktijk@voorbeeld.nl",
                 "Dank voor de selectie. Post 2 en 3 zijn top. Bij post 1 liever geen foto van de behandelkamer.",
                 second[1], agents["Klantcontact"], flows["maandcontent"], "klant-akkoord", 6),
                (f"demo:{tenant.slug}:shoot", f"Shoot {third[0]} in de studio", third[0], "hallo@voorbeeld.nl",
                 "Zullen we de shoot op de 14e doen? Dan kunnen we de nieuwe collectie meteen meenemen.",
                 third[1], agents["Content"], flows["shoot"], "draaiboek", 20),
                (f"demo:{tenant.slug}:onboarding", "Nieuwe klant: kennismaking", "Jeroen", "jeroen@voorbeeld.nl",
                 "Wij willen graag starten met het More-pakket voor Instagram en LinkedIn. Wanneer kunnen we de "
                 "kick-off plannen?", clients_root, agents["Projectleider"], flows["onboarding"], None, 4),
            ]
            for key, subject, sender, email, body, folder, agent, flow, stage, hours in samples:
                await _demo_conversation(
                    session, tenant, key=key, subject=subject, sender=sender, email=email, body=body, folder=folder,
                    agent=agent, flow=flow, stage_key=stage, hours_ago=hours,
                )
                demo += 1

        return {
            "tenant": tenant.slug,
            "tenant_id": str(tenant.id),
            "agents": sorted(agents),
            "domains": sorted(domains),
            "flows": sorted(flows),
            "clients": clients,
            "docs_created": docs_made,
            "demo_conversations": demo,
            "orientations": len(orientations),
        }


def main() -> None:
    parser = argparse.ArgumentParser(description="Set up an agency pilot workspace (idempotent)")
    parser.add_argument("--owner-email", required=True)
    parser.add_argument("--slug", default="lotsofcontent")
    parser.add_argument("--name", default="Lots Of Content")
    parser.add_argument("--clients", default="", help="Comma-separated client names (default: fictional)")
    parser.add_argument("--demo", action="store_true", help="Add sample conversations")
    print(json.dumps(asyncio.run(run(parser.parse_args())), indent=2))


if __name__ == "__main__":
    main()
