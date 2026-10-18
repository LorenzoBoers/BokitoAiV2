"""Server-side picture of one tenant's setup.

Nodes are created items. Edges are stored relationships (membership, ownership,
access grants, tag links, stage owners). The client paints coordinates and lines.
"""

from __future__ import annotations

import json
import math
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.auth import Tenant, User
from app.models.calendar import CalendarTagLink, TenantCalendar
from app.models.channel import ChannelAccount
from app.models.integration import IntegrationConnection
from app.models.module_agent import AgentScope, ModuleAgent
from app.models.module_install import ModuleInstall
from app.models.module_source import ModuleSource
from app.models.orchestra import Workstream
from app.models.project import Project, ProjectTagLink
from app.models.project_work import ProjectResource
from app.models.signal import SignalTag
from app.models.workspace import WorkspaceDoc
from app.services.access_list import normalize_entries
from app.services.agent_avatar import avatar_payload
from app.services.teams import list_teams, team_members

_CHANNEL_KEYS = frozenset({"email", "webchat", "internal", "agent", "slack", "whatsapp"})

CHIP = 70
COLS = 4
PAD = 28
HEADER = 40


def iso_point(x: float, y: float) -> tuple[float, float]:
    """Oblique Make-style tilt: logical plane → screen."""
    return (round((x - y) * 0.92, 1), round((x + y) * 0.48, 1))


def region_span(count: int) -> tuple[int, int, float, float]:
    total = max(count, 1)
    cols = 1 if total == 1 else min(COLS, total)
    rows = math.ceil(total / cols)
    return cols, rows, PAD * 2 + cols * CHIP, HEADER + PAD + rows * CHIP


def chip_points(origin_x: float, origin_y: float, count: int) -> list[tuple[float, float]]:
    cols, _rows, _w, _h = region_span(count)
    points = []
    for index in range(count):
        column = index % cols
        row = index // cols
        points.append((origin_x + PAD + column * CHIP + CHIP / 2, origin_y + HEADER + row * CHIP + CHIP / 2))
    return points


def screen_link(start: tuple[float, float], end: tuple[float, float]) -> list[list[float]]:
    return [list(start), [end[0], start[1]], list(end)]


def channel_href(channel: str, connection_id: UUID | None) -> str:
    """Communication folder for a channel account. Unknown kinds open Connections."""
    key = "webchat" if channel == "widget" else channel
    if key == "email" and connection_id:
        return f"/communication/channel/email/{connection_id}"
    if key in _CHANNEL_KEYS:
        return f"/communication/channel/{key}"
    return "/connections"


def _grants(raw: str | None, levels: tuple[str, ...]) -> list[dict[str, str]]:
    try:
        parsed = json.loads(raw or "[]")
    except json.JSONDecodeError:
        return []
    if isinstance(parsed, dict):
        parsed = parsed.get("access")
    return normalize_entries(parsed, levels) or []


def _specific_departments(raw: str | None, levels: tuple[str, ...]) -> list[str]:
    """Department grants that name one department. Everyone stays off the map."""
    found: list[str] = []
    for entry in _grants(raw, levels):
        if entry["kind"] != "department" or entry["id"] in ("people", "agents"):
            continue
        if entry["id"] not in found:
            found.append(entry["id"])
    return found


def settle(ids: list[str], pinned: dict[str, tuple[float, float]], links: list[tuple[str, str]]) -> dict[str, tuple[float, float]]:
    """Pull linked items together and keep the rest from landing on top of each other."""
    pos: dict[str, tuple[float, float]] = dict(pinned)
    for index, node_id in enumerate(ids):
        if node_id in pos:
            continue
        angle = index * 2.399963
        pos[node_id] = (math.cos(angle) * 420, math.sin(angle) * 420)
    for step in range(40):
        disp = {node_id: [0.0, 0.0] for node_id in ids}
        for left, source in enumerate(ids):
            sx, sy = pos[source]
            for target in ids[left + 1 :]:
                tx, ty = pos[target]
                dx, dy = sx - tx, sy - ty
                dist = math.hypot(dx, dy) or 0.01
                push = 14000 / (dist * dist)
                ux, uy = dx / dist * push, dy / dist * push
                disp[source][0] += ux
                disp[source][1] += uy
                disp[target][0] -= ux
                disp[target][1] -= uy
        for source, target in links:
            if source not in pos or target not in pos:
                continue
            sx, sy = pos[source]
            tx, ty = pos[target]
            dx, dy = tx - sx, ty - sy
            dist = math.hypot(dx, dy) or 0.01
            pull = (dist - 150) * 0.06
            ux, uy = dx / dist * pull, dy / dist * pull
            disp[source][0] += ux
            disp[source][1] += uy
            disp[target][0] -= ux
            disp[target][1] -= uy
        cool = 1 - step / 40
        for node_id in ids:
            if node_id in pinned:
                continue
            dx, dy = disp[node_id]
            dist = math.hypot(dx, dy) or 1
            step_len = min(dist, 36 * cool)
            x, y = pos[node_id]
            pos[node_id] = (x + dx / dist * step_len, y + dy / dist * step_len)
    return pos


_KIND_RANK = {
    "user": 1,
    "agent": 2,
    "channel": 3,
    "flow": 4,
    "folder": 5,
    "label": 6,
    "calendar": 7,
    "connection": 8,
    "doc": 9,
    "source": 10,
    "module": 11,
}


def _attach_marks(nodes, agents, user_rows, tags, accounts, calendars, connections) -> None:
    """Copy the same marks the rest of the product already stores."""
    people = {str(row.id): row for row in user_rows}
    tag_by_id = {str(row.id): row for row in tags}
    flow_mark: dict[str, dict[str, str]] = {}
    for tag in tags:
        if not tag.workstream_id:
            continue
        if tag.icon or tag.color:
            flow_mark.setdefault(str(tag.workstream_id), {"icon": tag.icon or "", "color": tag.color or ""})
    channel_by = {str(row.id): row for row in accounts}
    calendar_by = {str(row.id): row for row in calendars}
    for node in nodes.values():
        kind, _, ident = node["id"].partition(":")
        mark: dict[str, Any] = {}
        if kind == "agent":
            agent = agents.get(ident)
            if agent is not None:
                mark = avatar_payload(agent)
                mark["name"] = agent.name
        elif kind == "user":
            person = people.get(ident)
            image = (getattr(person, "avatar_url", None) or "") if person else ""
            mark = {
                "avatar_kind": "image" if image else "initials",
                "avatar_image_url": image or None,
                "name": node.get("label") or "",
            }
        elif kind == "label":
            tag = tag_by_id.get(ident)
            if tag is not None:
                mark = {"icon": tag.icon or "", "color": tag.color or ""}
        elif kind == "flow":
            mark = dict(flow_mark.get(ident) or {"icon": "route", "color": "sky"})
        elif kind == "channel":
            account = channel_by.get(ident)
            if account is not None:
                mark = {"channel": account.channel or "", "provider": account.provider or ""}
        elif kind == "calendar":
            calendar = calendar_by.get(ident)
            conn = connections.get(str(calendar.connection_id)) if calendar and calendar.connection_id else None
            if conn is not None:
                mark = {"provider": conn.provider or ""}
        elif kind == "connection":
            conn = connections.get(ident)
            if conn is not None:
                mark = {"provider": conn.provider or ""}
        elif kind == "organization":
            mark = {"provider": "bokito"}
        elif kind == "module":
            mark = {"provider": ident}
        node["mark"] = mark


def _rank_kind(kind: str) -> int:
    order = {
        "department": 0,
        "user": 1,
        "agent": 2,
        "label": 3,
        "flow": 4,
        "folder": 5,
        "channel": 6,
        "calendar": 7,
        "connection": 8,
        "webhook": 9,
        "module": 10,
        "doc": 11,
        "source": 12,
    }
    return order.get(kind, 20)


def collapse_label_bridges(
    nodes: dict[str, dict[str, Any]],
    links: list[tuple[str, str]],
) -> list[tuple[str, str]]:
    """Drop label chips from the map; keep their ties as direct lines.

    A label that sits between a flow and a folder becomes one flow—folder edge.
    Labels themselves are removed from ``nodes``.
    """
    label_ids = {node_id for node_id, row in nodes.items() if row.get("kind") == "label"}
    if not label_ids:
        return links
    neighbors: dict[str, set[str]] = {}
    for source, target in links:
        neighbors.setdefault(source, set()).add(target)
        neighbors.setdefault(target, set()).add(source)
    seen: set[tuple[str, str]] = set()
    bridged: list[tuple[str, str]] = []

    def push(a: str, b: str) -> None:
        if not a or not b or a == b or a in label_ids or b in label_ids:
            return
        if a not in nodes or b not in nodes:
            return
        key = tuple(sorted((a, b)))
        if key in seen:
            return
        seen.add(key)
        bridged.append((a, b))

    for source, target in links:
        if source not in label_ids and target not in label_ids:
            push(source, target)
    for label_id in label_ids:
        others = sorted(n for n in neighbors.get(label_id, ()) if n not in label_ids)
        for index, left in enumerate(others):
            for right in others[index + 1 :]:
                push(left, right)
    for label_id in label_ids:
        nodes.pop(label_id, None)
    return bridged


def arrange(
    nodes: dict[str, dict[str, Any]],
    links: list[tuple[str, str]],
    org_id: str,
    department_ids: list[str],
) -> tuple[dict[str, tuple[float, float]], dict[str, str], list[dict[str, Any]]]:
    """Radial Make Grid: organization at the origin, branches in 360°.

    Returns flat ground-plane coordinates (x/z for the client Three.js scene).
    The dashboard camera supplies the oblique 3D view.
    """
    neighbors: dict[str, set[str]] = {}
    for source, target in links:
        neighbors.setdefault(source, set()).add(target)
        neighbors.setdefault(target, set()).add(source)
    linked = {node_id for pair in links for node_id in pair}
    member_of: dict[str, set[str]] = {}
    for department_id in department_ids:
        for other in neighbors.get(department_id, ()):
            if nodes.get(other, {}).get("kind") in ("user", "agent"):
                member_of.setdefault(other, set()).add(department_id)
    shared = {node_id for node_id, homes in member_of.items() if len(homes) > 1}
    home: dict[str, str] = {department_id: department_id for department_id in department_ids}
    for node_id, homes in member_of.items():
        if len(homes) == 1:
            home[node_id] = next(iter(homes))
    dist = {department_id: 0 for department_id in department_ids}
    queue = list(department_ids)
    while queue:
        current = queue.pop(0)
        for other in neighbors.get(current, ()):
            if other in shared or other == org_id or other not in linked:
                continue
            if other in home and nodes[other]["kind"] in ("user", "agent"):
                continue
            step = dist[current] + 1
            if other not in dist or step < dist[other]:
                dist[other] = step
                home[other] = home[current]
                queue.append(other)
    for node_id in list(linked):
        if node_id in home or node_id == org_id or node_id in shared:
            continue
        others = [other for other in neighbors.get(node_id, ()) if other in linked and other != org_id]
        if others and all(other in shared for other in others):
            home[node_id] = "shared"
    leftover = [
        node_id
        for node_id in linked
        if node_id not in home and node_id != org_id and node_id not in shared and home.get(node_id) != "shared"
    ]
    seen: set[str] = set()
    extra: list[tuple[str, str]] = []
    for start in leftover:
        if start in seen:
            continue
        stack = [start]
        seen.add(start)
        component: list[str] = []
        while stack:
            current = stack.pop()
            component.append(current)
            for other in neighbors.get(current, ()):
                if other in leftover and other not in seen:
                    seen.add(other)
                    stack.append(other)
        title_id = max(
            component,
            key=lambda node_id: (
                {"folder": 3, "module": 2}.get(nodes[node_id]["kind"], 0),
                len(neighbors.get(node_id, ())),
            ),
        )
        plot_id = f"plot:{title_id}"
        for node_id in component:
            home[node_id] = plot_id
        extra.append((plot_id, nodes[title_id]["label"]))

    def sort_key(node_id: str) -> tuple[int, str]:
        return (_rank_kind(nodes[node_id]["kind"]), nodes[node_id]["label"].lower())

    cards: list[tuple[str, str, list[str]]] = []
    for department_id in department_ids:
        items = [node_id for node_id, plot in home.items() if plot == department_id]
        cards.append((department_id, nodes[department_id]["label"], items))
    for plot_id, label in extra:
        cards.append((plot_id, label, [node_id for node_id, plot in home.items() if plot == plot_id]))

    shared_ids = sorted(
        set(shared) | {node_id for node_id, plot in home.items() if plot == "shared"},
        key=sort_key,
    )
    for node_id in shared_ids:
        home[node_id] = "shared"

    logical: dict[str, tuple[float, float]] = {org_id: (0.0, 0.0)}
    home[org_id] = "overview"
    regions: list[dict[str, Any]] = []

    hub_r = 280.0 if len(cards) <= 6 else 320.0
    shared_r = 130.0
    # Children orbit the department hub (area model), not the org origin.
    child_base = 72.0
    child_step = 58.0
    per_ring = 6
    pad = 48.0

    n_shared = len(shared_ids)
    for index, node_id in enumerate(shared_ids):
        angle = -math.pi / 2 + (2 * math.pi * index / n_shared if n_shared else 0)
        # Offset shared slightly so they sit in the gaps between department rays.
        if cards:
            angle += math.pi / max(len(cards), 1)
        logical[node_id] = (math.cos(angle) * shared_r, math.sin(angle) * shared_r)

    n_cards = max(len(cards), 1)
    for index, (plot_id, label, items) in enumerate(cards):
        angle = -math.pi / 2 + 2 * math.pi * index / n_cards
        hx = math.cos(angle) * hub_r
        hy = math.sin(angle) * hub_r
        hub = plot_id if plot_id in nodes else None
        children = sorted((node_id for node_id in items if node_id != hub), key=sort_key)
        if hub:
            logical[hub] = (hx, hy)
            home[hub] = plot_id
        cluster_pts = [(hx, hy)]
        for child_index, node_id in enumerate(children):
            ring = child_index // per_ring
            slot = child_index % per_ring
            on_ring = min(per_ring, len(children) - ring * per_ring)
            # Full circle around the department center so the area reads as one island.
            slot_angle = angle + (2 * math.pi * slot / on_ring if on_ring else 0)
            local_r = child_base + ring * child_step
            cx = hx + math.cos(slot_angle) * local_r
            cy = hy + math.sin(slot_angle) * local_r
            logical[node_id] = (cx, cy)
            home[node_id] = plot_id
            cluster_pts.append((cx, cy))
        xs = [p[0] for p in cluster_pts]
        ys = [p[1] for p in cluster_pts]
        cx = sum(xs) / len(xs)
        cy = sum(ys) / len(ys)
        rx = max(abs(x - cx) for x in xs) + pad
        ry = max(abs(y - cy) for y in ys) + pad
        # Soft elliptical island instead of a hard rectangle.
        ellipse = []
        for step in range(24):
            t = 2 * math.pi * step / 24
            ellipse.append([round(cx + math.cos(t) * rx, 1), round(cy + math.sin(t) * ry, 1)])
        regions.append(
            {
                "id": plot_id,
                "label": label,
                "href": nodes.get(plot_id, {}).get("href"),
                "points": ellipse,
                "labelAt": [round(hx, 1), round(hy, 1)],
            }
        )

    positions = {node_id: (round(x, 1), round(y, 1)) for node_id, (x, y) in logical.items()}
    return positions, home, regions


def curve_points(ax: float, ay: float, bx: float, by: float) -> list[list[float]]:
    """Cubic control points between two node centers (soft radial arcs)."""
    dx = bx - ax
    dy = by - ay
    if abs(dx) < 12 and abs(dy) < 12:
        return [[round(ax, 1), round(ay, 1)], [round(bx, 1), round(by, 1)]]
    # Pull control points toward the origin side of the chord so spokes feel radial.
    mx, my = (ax + bx) / 2, (ay + by) / 2
    c1x, c1y = ax + dx * 0.35 + (mx - ax) * 0.15, ay + dy * 0.35 + (my - ay) * 0.15
    c2x, c2y = ax + dx * 0.65 + (mx - bx) * 0.15, ay + dy * 0.65 + (my - by) * 0.15
    return [
        [round(ax, 1), round(ay, 1)],
        [round(c1x, 1), round(c1y, 1)],
        [round(c2x, 1), round(c2y, 1)],
        [round(bx, 1), round(by, 1)],
    ]


def _stage_owners(raw: str) -> list[tuple[str, str]]:
    try:
        data = json.loads(raw or "[]")
    except json.JSONDecodeError:
        return []
    if not isinstance(data, list):
        return []
    owners: list[tuple[str, str]] = []
    for item in data:
        if not isinstance(item, dict) or not isinstance(item.get("owner"), dict):
            continue
        kind = str(item["owner"].get("kind") or "")
        if kind == "team":
            kind = "department"
        owner_id = str(item["owner"].get("id") or "")
        if kind in ("department", "user", "agent") and owner_id:
            owners.append((kind, owner_id))
    return owners


async def build_org_graph(session: AsyncSession, tenant_id: UUID) -> dict[str, Any]:
    tenant = await session.get(Tenant, tenant_id)
    departments = await list_teams(session, tenant_id, include_system=False)
    nodes: dict[str, dict[str, Any]] = {}
    links: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()

    def add(node_id: str, kind: str, label: str, href: str) -> None:
        nodes.setdefault(node_id, {"id": node_id, "kind": kind, "label": label or node_id, "href": href})

    def link(source: str, target: str) -> None:
        if not source or not target or source == target:
            return
        if source not in nodes or target not in nodes:
            return
        key = tuple(sorted((source, target)))
        if key in seen:
            return
        seen.add(key)
        links.append((source, target))

    org_id = f"organization:{tenant_id}"
    add(org_id, "organization", tenant.name if tenant else "", "/team")
    dept_ids = {str(row.id) for row in departments}
    for department in departments:
        dep = f"department:{department.id}"
        add(dep, "department", department.name, f"/communication/team/{department.id}")
        link(org_id, dep)
        for member in await team_members(session, department):
            mid = f"{member.kind}:{member.id}"
            href = f"/agents/{member.id}" if member.kind == "agent" else "/team"
            add(mid, member.kind, member.duty, href)
            link(dep, mid)

    user_ids = [UUID(node_id.split(":", 1)[1]) for node_id in nodes if node_id.startswith("user:")]
    user_rows = []
    if user_ids:
        user_rows = list((await session.execute(select(User).where(User.id.in_(user_ids)))).scalars().all())
    users = {str(row.id): (row.display_name or row.email or "").strip() for row in user_rows}
    # Bokito (acts_for_user) is the in-app helper, not a company org-map node.
    agents = {
        str(row.id): row
        for row in (
            await session.execute(
                select(Agent).where(
                    Agent.tenant_id == tenant_id,
                    Agent.is_active.is_(True),
                    Agent.acts_for_user.is_(False),
                )
            )
        ).scalars().all()
    }
    for agent_id, agent in agents.items():
        node_id = f"agent:{agent_id}"
        if node_id in nodes:
            nodes[node_id]["label"] = agent.name
        elif agent.managed_origin == "module" and agent.managed_ref:
            add(node_id, "agent", agent.name, f"/agents/{agent_id}")
    for user_id, name in users.items():
        node = nodes.get(f"user:{user_id}")
        if node and name:
            node["label"] = name

    tags = list(
        (await session.execute(select(SignalTag).where(SignalTag.tenant_id == tenant_id))).scalars().all()
    )
    flows = list(
        (
            await session.execute(
                select(Workstream).where(Workstream.tenant_id == tenant_id, Workstream.deleted_at.is_(None))
            )
        ).scalars().all()
    )
    folders = list(
        (
            await session.execute(select(Project).where(Project.tenant_id == tenant_id, Project.deleted_at.is_(None)))
        ).scalars().all()
    )
    for tag in tags:
        add(f"label:{tag.id}", "label", f"#{tag.name}", f"/communication/tag/{tag.name}")
    for flow in flows:
        add(f"flow:{flow.id}", "flow", flow.name, f"/workstreams/{flow.id}")
    for folder in folders:
        add(f"folder:{folder.id}", "folder", folder.name, f"/folders/{folder.id}")

    for tag in tags:
        if tag.workstream_id:
            link(f"label:{tag.id}", f"flow:{tag.workstream_id}")
    for flow in flows:
        for kind, owner_id in _stage_owners(flow.stages_json):
            owner = f"{kind}:{owner_id}"
            if kind == "department" and owner_id not in dept_ids:
                continue
            if kind == "agent" and owner_id in agents:
                add(owner, "agent", agents[owner_id].name, f"/agents/{owner_id}")
            if owner in nodes:
                link(f"flow:{flow.id}", owner)
    for tag in tags:
        if not tag.workstream_id:
            continue
        for kind, owner_id in _stage_owners(next((row.stages_json for row in flows if row.id == tag.workstream_id), "[]")):
            if kind == "department" and f"department:{owner_id}" in nodes:
                link(f"department:{owner_id}", f"label:{tag.id}")

    for row in (
        await session.execute(select(ProjectTagLink).where(ProjectTagLink.tenant_id == tenant_id))
    ).scalars().all():
        link(f"folder:{row.project_id}", f"label:{row.tag_id}")
    for folder in folders:
        if folder.parent_id:
            link(f"folder:{folder.id}", f"folder:{folder.parent_id}")

    accounts = list(
        (
            await session.execute(
                select(ChannelAccount).where(
                    ChannelAccount.tenant_id == tenant_id,
                    ChannelAccount.archived_at.is_(None),
                )
            )
        ).scalars().all()
    )
    for account in accounts:
        node_id = f"channel:{account.id}"
        add(node_id, "channel", account.display_name or account.address or account.channel, channel_href(account.channel, account.connection_id))
        try:
            settings = json.loads(account.settings_json or "{}")
        except json.JSONDecodeError:
            settings = {}
        routing = settings.get("routing") if isinstance(settings.get("routing"), dict) else {}
        routed = str(routing.get("department_id") or routing.get("team_id") or "")
        if routed and f"department:{routed}" in nodes:
            link(node_id, f"department:{routed}")
        routed_user = str(routing.get("user_id") or "")
        if routed_user:
            add(f"user:{routed_user}", "user", users.get(routed_user, ""), "/team")
            link(node_id, f"user:{routed_user}")
        for department_id in _specific_departments(json.dumps(settings.get("access")), ("view", "handle")):
            link(node_id, f"department:{department_id}")
        if account.default_agent_id and str(account.default_agent_id) in agents:
            agent_id = str(account.default_agent_id)
            add(f"agent:{agent_id}", "agent", agents[agent_id].name, f"/agents/{agent_id}")
            link(node_id, f"agent:{agent_id}")
        if account.connection_id:
            add(f"connection:{account.connection_id}", "connection", "", "/connections")
            link(node_id, f"connection:{account.connection_id}")

    connections = {
        str(row.id): row
        for row in (
            await session.execute(
                select(IntegrationConnection).where(IntegrationConnection.tenant_id == tenant_id)
            )
        ).scalars().all()
    }
    for row in (
        await session.execute(
            select(ProjectResource).where(
                ProjectResource.tenant_id == tenant_id,
                ProjectResource.deleted_at.is_(None),
                ProjectResource.connection_id.is_not(None),
            )
        )
    ).scalars().all():
        if f"folder:{row.project_id}" not in nodes or not row.connection_id:
            continue
        conn = connections.get(str(row.connection_id))
        add(
            f"connection:{row.connection_id}",
            "connection",
            (conn.display_name or conn.provider) if conn else (row.label or ""),
            "/connections",
        )
        link(f"folder:{row.project_id}", f"connection:{row.connection_id}")

    calendars = list(
        (await session.execute(select(TenantCalendar).where(TenantCalendar.tenant_id == tenant_id))).scalars().all()
    )
    for calendar in calendars:
        node_id = f"calendar:{calendar.id}"
        add(node_id, "calendar", calendar.name, "/agenda")
        if calendar.connection_id:
            conn = connections.get(str(calendar.connection_id))
            add(
                f"connection:{calendar.connection_id}",
                "connection",
                (conn.display_name or conn.provider) if conn else "",
                "/connections",
            )
            link(node_id, f"connection:{calendar.connection_id}")
        for department_id in _specific_departments(calendar.access_json, ("use", "manage")):
            link(node_id, f"department:{department_id}")
    for row in (
        await session.execute(select(CalendarTagLink).where(CalendarTagLink.tenant_id == tenant_id))
    ).scalars().all():
        link(f"calendar:{row.calendar_id}", f"label:{row.tag_id}")

    for conn_id, conn in connections.items():
        node_id = f"connection:{conn_id}"
        if node_id not in nodes:
            continue
        nodes[node_id]["label"] = conn.display_name or conn.provider
        try:
            meta = json.loads(conn.metadata_json or "{}")
        except json.JSONDecodeError:
            meta = {}
        for department_id in _specific_departments(json.dumps(meta.get("access")), ("use", "manage")):
            link(node_id, f"department:{department_id}")

    for agent_id, agent in agents.items():
        node_id = f"agent:{agent_id}"
        if agent.managed_origin == "module" and agent.managed_ref:
            add(f"module:{agent.managed_ref}", "module", agent.managed_ref, f"/connections/{agent.managed_ref}")
            add(node_id, "agent", agent.name, f"/agents/{agent_id}")
            link(node_id, f"module:{agent.managed_ref}")

    installs = list(
        (
            await session.execute(
                select(ModuleInstall).where(
                    ModuleInstall.tenant_id == tenant_id,
                    ModuleInstall.install_state != "not_installed",
                )
            )
        ).scalars().all()
    )
    for install in installs:
        add(f"module:{install.module_slug}", "module", install.module_slug, f"/connections/{install.module_slug}")
    for row in (
        await session.execute(select(ModuleAgent).where(ModuleAgent.tenant_id == tenant_id))
    ).scalars().all():
        if str(row.agent_id) in agents:
            add(f"module:{row.module_slug}", "module", row.module_slug, f"/connections/{row.module_slug}")
            add(f"agent:{row.agent_id}", "agent", agents[str(row.agent_id)].name, f"/agents/{row.agent_id}")
            link(f"agent:{row.agent_id}", f"module:{row.module_slug}")
    for flow in flows:
        if flow.module_slug:
            add(f"module:{flow.module_slug}", "module", flow.module_slug, f"/connections/{flow.module_slug}")
            link(f"flow:{flow.id}", f"module:{flow.module_slug}")
    docs = list(
        (
            await session.execute(
                select(WorkspaceDoc).where(
                    WorkspaceDoc.tenant_id == tenant_id,
                    WorkspaceDoc.kind.in_(("doc", "project_doc", "skill")),
                )
            )
        ).scalars().all()
    )
    for doc in docs:
        if not doc.project_id and not doc.agent_id:
            continue
        add(f"doc:{doc.id}", "doc", doc.title or doc.path, "/knowledge")
        if doc.project_id:
            link(f"doc:{doc.id}", f"folder:{doc.project_id}")
        if doc.agent_id:
            link(f"doc:{doc.id}", f"agent:{doc.agent_id}")

    for row in (
        await session.execute(select(ModuleSource).where(ModuleSource.tenant_id == tenant_id))
    ).scalars().all():
        if row.origin != "tenant" and not row.workspace_doc_id:
            continue
        source_id = f"source:{row.id}"
        add(source_id, "source", row.title or row.url or row.module_slug, f"/connections/{row.module_slug}")
        add(f"module:{row.module_slug}", "module", row.module_slug, f"/connections/{row.module_slug}")
        link(source_id, f"module:{row.module_slug}")
        if row.workspace_doc_id:
            link(source_id, f"doc:{row.workspace_doc_id}")

    for row in (
        await session.execute(select(AgentScope).where(AgentScope.tenant_id == tenant_id))
    ).scalars().all():
        agent = agents.get(str(row.agent_id))
        if agent is None:
            continue
        agent_node = f"agent:{row.agent_id}"
        add(agent_node, "agent", agent.name, f"/agents/{row.agent_id}")
        if row.resource_kind == "project":
            link(agent_node, f"folder:{row.resource_id}")
        elif row.resource_kind == "channel":
            link(agent_node, f"channel:{row.resource_id}")
        elif row.resource_kind == "knowledge":
            link(agent_node, f"doc:{row.resource_id}")
        elif row.resource_kind == "connection":
            target = row.connection_id or row.resource_id
            link(agent_node, f"connection:{target}")

    from app.models.relations import (
        ResourceGrant,
        WorkstreamChannel,
        WorkstreamConnection,
        WorkstreamStage,
        WorkstreamStageOwner,
    )
    from app.models.webhook import WebhookEndpoint

    installs = {
        row.id: row.module_slug
        for row in (
            await session.execute(select(ModuleInstall).where(ModuleInstall.tenant_id == tenant_id))
        ).scalars().all()
    }
    for grant in (
        await session.execute(select(ResourceGrant).where(ResourceGrant.tenant_id == tenant_id))
    ).scalars().all():
        if grant.principal_kind != "department" or grant.department_id is None:
            continue
        target = f"department:{grant.department_id}"
        if grant.channel_account_id:
            link(f"channel:{grant.channel_account_id}", target)
        elif grant.calendar_id:
            link(f"calendar:{grant.calendar_id}", target)
        elif grant.connection_id:
            link(f"connection:{grant.connection_id}", target)
        elif grant.module_install_id and installs.get(grant.module_install_id):
            slug = installs[grant.module_install_id]
            add(f"module:{slug}", "module", slug, f"/connections/{slug}")
            link(f"module:{slug}", target)

    for account in accounts:
        if account.routing_user_id:
            link(f"channel:{account.id}", f"user:{account.routing_user_id}")
        elif account.routing_department_id:
            link(f"channel:{account.id}", f"department:{account.routing_department_id}")

    stage_rows = list(
        (
            await session.execute(select(WorkstreamStage).where(WorkstreamStage.tenant_id == tenant_id))
        ).scalars().all()
    )
    stage_flow = {row.id: row.workstream_id for row in stage_rows}
    for owner in (
        await session.execute(
            select(WorkstreamStageOwner).where(WorkstreamStageOwner.tenant_id == tenant_id)
        )
    ).scalars().all():
        flow_id = stage_flow.get(owner.stage_id)
        if flow_id is None:
            continue
        if owner.department_id:
            link(f"flow:{flow_id}", f"department:{owner.department_id}")
        elif owner.agent_id:
            link(f"flow:{flow_id}", f"agent:{owner.agent_id}")
        elif owner.user_id:
            link(f"flow:{flow_id}", f"user:{owner.user_id}")

    for row in (
        await session.execute(select(WorkstreamChannel).where(WorkstreamChannel.tenant_id == tenant_id))
    ).scalars().all():
        link(f"flow:{row.workstream_id}", f"channel:{row.channel_account_id}")
    for row in (
        await session.execute(
            select(WorkstreamConnection).where(WorkstreamConnection.tenant_id == tenant_id)
        )
    ).scalars().all():
        link(f"flow:{row.workstream_id}", f"connection:{row.connection_id}")

    for folder in folders:
        if folder.department_id:
            link(f"folder:{folder.id}", f"department:{folder.department_id}")

    for hook in (
        await session.execute(select(WebhookEndpoint).where(WebhookEndpoint.tenant_id == tenant_id))
    ).scalars().all():
        if not hook.workstream_id:
            continue
        add(f"webhook:{hook.id}", "webhook", hook.description or hook.url or "Webhook", "/settings/developers")
        link(f"webhook:{hook.id}", f"flow:{hook.workstream_id}")

    # Drop edges that pointed at items we never created, then drop items with no tie
    # except the organization and departments, which are the spine.
    links = [(source, target) for source, target in links if source in nodes and target in nodes]
    # Labels stay in the data model as filing tags, but on the canvas they are
    # invisible hubs: their neighbors get a direct line instead of a #chip.
    links = collapse_label_bridges(nodes, links)
    department_ids = sorted(
        (f"department:{row.id}" for row in departments if f"department:{row.id}" in nodes),
        key=lambda node_id: nodes[node_id]["label"].lower(),
    )
    placed, home, regions = arrange(nodes, links, org_id, department_ids)
    _attach_marks(nodes, agents, user_rows, tags, accounts, calendars, connections)
    painted = []
    for node in nodes.values():
        x, y = placed.get(node["id"], (0.0, 0.0))
        painted.append({**node, "x": round(x, 1), "y": round(y, 1), "region": home.get(node["id"], "")})

    edges = []
    for source, target in links:
        if source not in placed or target not in placed:
            continue
        ax, ay = placed[source]
        bx, by = placed[target]
        pair = {nodes[source]["kind"], nodes[target]["kind"]}
        if "organization" in pair:
            relation = "org"
        elif "department" in pair and pair <= {"department", "user", "agent"}:
            relation = "member"
        else:
            relation = "item"
        edges.append(
            {
                "id": f"link:{len(edges)}",
                "kind": relation,
                "source": source,
                "target": target,
                "points": curve_points(ax, ay, bx, by),
            }
        )
    return {
        "revision": len(painted) + len(edges),
        "projection": "make-3d",
        "regions": regions,
        "nodes": painted,
        "edges": edges,
    }
