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

from app.models.auth import Tenant, User
from app.models.calendar import CalendarTagLink, TenantCalendar
from app.models.channel import ChannelAccount
from app.models.integration import IntegrationConnection
from app.models.module_agent import AgentScope
from app.models.module_source import ModuleSource
from app.models.project import Project, ProjectTagLink
from app.models.project_work import ProjectResource
from app.models.signal import SignalTag
from app.models.team import Department
from app.models.workspace import WorkspaceDoc
from app.services.access_list import normalize_entries
from app.services.agent_avatar import avatar_payload
from app.services.teams import ensure_all_department, list_teams, team_members

_CHANNEL_KEYS = frozenset({"email", "webchat", "internal", "agent", "slack", "whatsapp"})

# Chip grid pitch inside a rectangular plot (legacy span helper).
CHIP = 56
COLS = 4
PAD = 20
HEADER = 32


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


def settle(
    ids: list[str],
    pinned: dict[str, tuple[float, float]],
    links: list[tuple[str, str]],
    *,
    push_gain: float = 14000.0,
    rest: float = 150.0,
    anchors: dict[str, tuple[float, float]] | None = None,
    anchor_k: float = 0.0,
) -> dict[str, tuple[float, float]]:
    """Pull linked items together and keep the rest from landing on top of each other."""
    pos: dict[str, tuple[float, float]] = dict(pinned)
    held = anchors or {}
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
                push = push_gain / (dist * dist)
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
            pull = (dist - rest) * 0.06
            ux, uy = dx / dist * pull, dy / dist * pull
            disp[source][0] += ux
            disp[source][1] += uy
            disp[target][0] -= ux
            disp[target][1] -= uy
        if anchor_k:
            for node_id in ids:
                if node_id in pinned or node_id not in held:
                    continue
                ax, ay = held[node_id]
                x, y = pos[node_id]
                disp[node_id][0] += (ax - x) * anchor_k
                disp[node_id][1] += (ay - y) * anchor_k
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


# Outer radius of the All halo around the company logo.
ALL_AREA_RADIUS = 52.0
# Open band between that halo and the nearest island edge. Members sit here.
MEMBER_CORRIDOR = 64.0
# Two pucks are ~7.5 units across in the scene. Keep a gap so people do not stack.
MEMBER_CLEARANCE = 30.0


def _island_radius(region: dict[str, Any], logical: dict[str, tuple[float, float]]) -> float:
    rid = str(region["id"])
    if rid not in logical:
        return 0.0
    hx, hy = logical[rid]
    rad = 0.0
    for point in region.get("points") or []:
        rad = max(rad, math.hypot(point[0] - hx, point[1] - hy))
    return rad


def _shift_island(
    logical: dict[str, tuple[float, float]],
    home: dict[str, str],
    regions: list[dict[str, Any]],
    hid: str,
    dx: float,
    dy: float,
) -> None:
    for node_id, (x, y) in list(logical.items()):
        if node_id == hid or home.get(node_id) == hid:
            logical[node_id] = (x + dx, y + dy)
    for region in regions:
        if region["id"] != hid:
            continue
        region["points"] = [
            [round(point[0] + dx, 1), round(point[1] + dy, 1)] for point in region["points"]
        ]
        label_at = region.get("labelAt")
        if label_at:
            region["labelAt"] = [round(label_at[0] + dx, 1), round(label_at[1] + dy, 1)]


def clear_all_halo(
    logical: dict[str, tuple[float, float]],
    home: dict[str, str],
    regions: list[dict[str, Any]],
    org_id: str,
    *,
    all_radius: float = ALL_AREA_RADIUS,
    corridor: float = MEMBER_CORRIDOR,
) -> None:
    """Slide each island outward until its inner edge clears the All halo.

    The free band is where members sit. A large department moves farther out
    instead of covering the company ring.
    """
    for region in regions:
        hid = str(region["id"])
        if hid == org_id or hid not in logical or not str(hid).startswith("department:"):
            continue
        rad = _island_radius(region, logical)
        if rad <= 0:
            continue
        hx, hy = logical[hid]
        dist = math.hypot(hx, hy) or 1.0
        need = all_radius + corridor + rad
        if dist >= need - 0.5:
            continue
        delta = need - dist
        _shift_island(logical, home, regions, hid, hx / dist * delta, hy / dist * delta)


def seat_shared_members(
    logical: dict[str, tuple[float, float]],
    member_of: dict[str, set[str]],
    regions: list[dict[str, Any]] | None = None,
    *,
    all_radius: float = ALL_AREA_RADIUS,
) -> None:
    """Seat every member in the open band between the All halo and their islands.

    One department: on the ray, halfway between the halo and that island.
    Several departments: the wedge between those seats. If that average falls
    back into the halo, keep the angle and sit on the band instead.
    """
    island_radius: dict[str, float] = {}
    for region in regions or []:
        rad = _island_radius(region, logical)
        if rad > 0:
            island_radius[str(region["id"])] = rad

    def gap(hid: str) -> tuple[float, float] | None:
        if hid not in logical:
            return None
        hx, hy = logical[hid]
        dist = math.hypot(hx, hy) or 1.0
        island = island_radius.get(hid, 70.0)
        inner = dist - island
        seat_r = (all_radius + inner) / 2.0 if inner > all_radius + 18.0 else all_radius + 28.0
        return (hx / dist * seat_r, hy / dist * seat_r)

    placed: list[tuple[str, float, float]] = []
    for node_id, homes in member_of.items():
        seats = [point for hid in homes if (point := gap(hid)) is not None]
        if not seats:
            continue
        ax = sum(point[0] for point in seats) / len(seats)
        ay = sum(point[1] for point in seats) / len(seats)
        radius = math.hypot(ax, ay)
        if radius < all_radius + 16.0:
            angle = math.atan2(ay, ax) if radius > 1.0 else math.atan2(seats[0][1], seats[0][0])
            band = sum(math.hypot(point[0], point[1]) for point in seats) / len(seats)
            ax, ay = math.cos(angle) * band, math.sin(angle) * band
        placed.append((node_id, ax, ay))
    _spread_members(logical, placed)


def _local_adj(
    ids: list[str], links: list[tuple[str, str]]
) -> dict[str, list[str]]:
    idset = set(ids)
    adj: dict[str, list[str]] = {node_id: [] for node_id in ids}
    for source, target in links:
        if source in idset and target in idset and source != target:
            adj[source].append(target)
            adj[target].append(source)
    return adj


def _chain_order(ids: list[str], adj: dict[str, list[str]]) -> list[str]:
    """Walk linked nodes first so neighbors land next to each other on a ring."""
    if not ids:
        return []
    degree = {node_id: len(set(adj[node_id])) for node_id in ids}
    remaining = set(ids)
    start = max(ids, key=lambda node_id: (degree[node_id], node_id))
    order = [start]
    remaining.remove(start)
    while remaining:
        linked = [node_id for node_id in adj[order[-1]] if node_id in remaining]
        pool = linked or list(remaining)
        nxt = max(pool, key=lambda node_id: (degree[node_id], node_id))
        order.append(nxt)
        remaining.remove(nxt)
    return order


def cluster_disc(
    ids: list[str],
    links: list[tuple[str, str]],
    ox: float,
    oy: float,
    facing: float,
    inner: float,
    outer: float,
) -> dict[str, tuple[float, float]]:
    """Seat a department's items as a small network, not an alphabetical ring.

    Busy nodes sit on the inner ring. Each other item sits on the outer ring,
    in the slice of the node it actually links to, so a line stays short.
    """
    if not ids:
        return {}
    adj = _local_adj(ids, links)
    degree = {node_id: len(set(adj[node_id])) for node_id in ids}
    hubs = [node_id for node_id in ids if degree[node_id] >= 3]
    if len(hubs) > 3:
        # A dense clique reads clearer as one ring than as nested hubs.
        order = _chain_order(ids, adj)
        pos = {}
        radius = outer if len(ids) > 1 else inner
        for index, node_id in enumerate(order):
            angle = facing + 2 * math.pi * index / len(order)
            pos[node_id] = (
                ox + math.cos(angle) * radius,
                oy + math.sin(angle) * radius,
            )
        return pos
    if not hubs:
        hubs = [max(ids, key=lambda node_id: (degree[node_id], node_id))]
    hubset = set(hubs)
    groups: dict[str, list[str]] = {hub: [] for hub in hubs}
    loose: list[str] = []
    for node_id in ids:
        if node_id in hubset:
            continue
        choices = [hub for hub in adj[node_id] if hub in hubset]
        if not choices:
            loose.append(node_id)
            continue
        primary = max(choices, key=lambda hub: (degree[hub], hub))
        groups[primary].append(node_id)
    for members in groups.values():
        members.sort()
    loose.sort()
    parts = [(hub, groups[hub]) for hub in _chain_order(hubs, adj)]
    total = sum(max(len(members), 1) for _, members in parts) + len(loose) or 1
    pos: dict[str, tuple[float, float]] = {}
    cursor = facing

    def at(angle: float, radius: float) -> tuple[float, float]:
        return (ox + math.cos(angle) * radius, oy + math.sin(angle) * radius)

    for hub, members in parts:
        sector = 2 * math.pi * max(len(members), 1) / total
        mid = cursor + sector / 2
        hub_r = inner * 0.42 if len(parts) == 1 and not loose else inner
        pos[hub] = at(mid, hub_r)
        count = len(members)
        pad = sector * 0.14
        span = max(sector - 2 * pad, sector * 0.55)
        for index, node_id in enumerate(members):
            angle = mid if count == 1 else mid - span / 2 + span * index / (count - 1)
            pos[node_id] = at(angle, outer)
        cursor += sector
    for node_id in loose:
        sector = 2 * math.pi / total
        pos[node_id] = at(cursor + sector / 2, outer)
        cursor += sector
    if len(pos) > 1:
        local = [(source, target) for source, target in links if source in pos and target in pos]
        settled = settle(
            list(pos),
            {},
            local,
            push_gain=18000.0,
            rest=64.0,
            anchors=dict(pos),
            anchor_k=0.9,
        )
        for node_id, (x, y) in settled.items():
            dx, dy = x - ox, y - oy
            dist = math.hypot(dx, dy) or 1.0
            keep = inner * 0.55
            if dist < keep:
                x = ox + dx / dist * keep
                y = oy + dy / dist * keep
            cap = outer + 8.0
            if dist > cap:
                x = ox + dx / dist * cap
                y = oy + dy / dist * cap
            pos[node_id] = (x, y)
    return pos


def _spread_members(
    logical: dict[str, tuple[float, float]],
    placed: list[tuple[str, float, float]],
    *,
    gap: float = MEMBER_CLEARANCE,
) -> None:
    """Fan members who share a seat out along the corridor.

    Everyone in one department would otherwise land on the same point.
    """
    groups: dict[tuple[float, float], list[tuple[str, float, float]]] = {}
    for node_id, ax, ay in placed:
        key = (round(ax, 1), round(ay, 1))
        groups.setdefault(key, []).append((node_id, ax, ay))
    for members in groups.values():
        members.sort(key=lambda item: item[0])
        _, ax, ay = members[0]
        radius = math.hypot(ax, ay) or 1.0
        tx, ty = -ay / radius, ax / radius
        count = len(members)
        span = (count - 1) * gap
        for index, (node_id, _, _) in enumerate(members):
            offset = -span / 2.0 + index * gap
            logical[node_id] = (ax + tx * offset, ay + ty * offset)


def relax_islands(
    logical: dict[str, tuple[float, float]],
    home: dict[str, str],
    regions: list[dict[str, Any]],
    org_id: str,
) -> bool:
    """Push department islands apart when their discs overlap.

    Uses ``settle`` on the island hubs only. The company center stays pinned.
    Hubs spring back toward the ring so a crowded map does not fly apart.
    Returns whether any hub moved.
    """
    hubs: list[str] = []
    radius: dict[str, float] = {}
    for region in regions:
        rid = str(region["id"])
        if rid == org_id or rid not in logical or not rid.startswith("department:"):
            continue
        hx, hy = logical[rid]
        rad = 0.0
        for point in region.get("points") or []:
            rad = max(rad, math.hypot(point[0] - hx, point[1] - hy))
        if rad <= 0:
            continue
        hubs.append(rid)
        radius[rid] = rad
    if len(hubs) < 2:
        return False
    gap = 12.0

    def overlapping() -> bool:
        for index, left in enumerate(hubs):
            lx, ly = logical[left]
            for right in hubs[index + 1 :]:
                rx, ry = logical[right]
                if math.hypot(lx - rx, ly - ry) < radius[left] + radius[right] + gap:
                    return True
        return False

    if not overlapping():
        return False
    anchors = {hid: logical[hid] for hid in hubs}
    settled = settle(hubs, {}, [], push_gain=2_400_000.0, anchors=anchors, anchor_k=0.55)
    moved = False
    for hid in hubs:
        ox, oy = anchors[hid]
        nx, ny = settled[hid]
        dx, dy = nx - ox, ny - oy
        dist = math.hypot(dx, dy)
        if dist < 0.5:
            continue
        if dist > 72:
            dx, dy = dx / dist * 72, dy / dist * 72
        for node_id, (x, y) in list(logical.items()):
            if node_id == hid or home.get(node_id) == hid:
                logical[node_id] = (x + dx, y + dy)
        for region in regions:
            if region["id"] != hid:
                continue
            region["points"] = [
                [round(point[0] + dx, 1), round(point[1] + dy, 1)] for point in region["points"]
            ]
            label_at = region.get("labelAt")
            if label_at:
                region["labelAt"] = [round(label_at[0] + dx, 1), round(label_at[1] + dy, 1)]
        moved = True
    return moved


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


def _company_logo_url(tenant: Tenant | None) -> str:
    """Branding pictogram: company logo, then favicon. Stored marks pass through."""
    if tenant is None:
        return ""
    try:
        settings = json.loads(tenant.settings_json or "{}")
    except json.JSONDecodeError:
        settings = {}
    if not isinstance(settings, dict):
        settings = {}
    livechat = settings.get("livechat_settings")
    if not isinstance(livechat, dict):
        livechat = {}
    appearance = livechat.get("appearance")
    if not isinstance(appearance, dict):
        appearance = {}
    candidates = (
        tenant.logo_url,
        livechat.get("logo_url"),
        appearance.get("widget_favicon_url"),
        livechat.get("favicon_url"),
        settings.get("favicon_url"),
    )
    for value in candidates:
        text = str(value or "").strip()
        if text:
            return text
    return ""


def _attach_marks(nodes, agents, user_rows, tags, accounts, calendars, connections, tenant: Tenant | None) -> None:
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
        if node.get("kind") == "organization":
            # The center id is department:{all}, so the face cannot follow the id prefix.
            mark = {
                "avatar_image_url": _company_logo_url(tenant) or None,
                "name": node.get("label") or "",
            }
        elif kind == "agent":
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
    # Items whose only area is All sit on that island, even when a flow or
    # agent link already pulled them onto another island. People and agents
    # stay on their custom departments; All's roster is not drawn.
    for node_id in list(linked):
        if node_id == org_id or node_id in shared:
            continue
        if nodes[node_id]["kind"] in ("user", "agent"):
            continue
        areas = [
            other
            for other in neighbors.get(node_id, ())
            if other == org_id or nodes.get(other, {}).get("kind") == "department"
        ]
        if areas and all(other == org_id for other in areas):
            home[node_id] = org_id
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
        # No live department: sit on All. A spare island would look like an area
        # the company does not have.
        for node_id in component:
            home[node_id] = org_id

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

    center_ids = sorted(
        (node_id for node_id, plot in home.items() if plot == org_id and node_id != org_id),
        key=sort_key,
    )
    center_extent = 0.0
    if center_ids:
        # One ring around the logo. Linked items share a slice so chords stay short.
        center_ring = 46.0 if len(center_ids) <= 8 else 56.0
        for node_id, (x, y) in cluster_disc(
            center_ids, links, 0.0, 0.0, -math.pi / 2, center_ring, center_ring
        ).items():
            logical[node_id] = (x, y)
            center_extent = max(center_extent, math.hypot(x, y))

    # Keep the map compact: wide rings leave a huge empty stage on the Grid.
    hub_r = 138.0 if len(cards) <= 6 else 162.0
    shared_r = 62.0 if not center_ids else center_extent + 40.0
    if center_ids and hub_r < shared_r + 70.0:
        hub_r = shared_r + 70.0
    # Children orbit the department hub. Tighter rings keep a busy island
    # (accounting) from swallowing the center; clearance still pushes it out.
    child_base = 30.0
    child_step = 24.0
    # Island fill padding around seated items — smaller = narrower white pads.
    pad = 12.0

    n_cards = max(len(cards), 1)
    for index, (plot_id, label, items) in enumerate(cards):
        angle = -math.pi / 2 + 2 * math.pi * index / n_cards
        hx = math.cos(angle) * hub_r
        hy = math.sin(angle) * hub_r
        hub = plot_id if plot_id in nodes else None
        children = sorted(
            (
                node_id
                for node_id in items
                if node_id != hub and nodes[node_id]["kind"] not in ("user", "agent")
            ),
            key=sort_key,
        )
        if hub:
            logical[hub] = (hx, hy)
            home[hub] = plot_id
        cluster_pts = [(hx, hy)]
        # Face the open side of the island outward, away from the company.
        seated = cluster_disc(children, links, hx, hy, angle, child_base, child_base + child_step)
        for node_id, (cx, cy) in seated.items():
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

    # All is the halo around the logo. Grow it only enough to hold center items.
    all_radius = max(ALL_AREA_RADIUS, center_extent + 20.0)
    all_ring = []
    for step in range(24):
        t = 2 * math.pi * step / 24
        all_ring.append(
            [round(math.cos(t) * all_radius, 1), round(math.sin(t) * all_radius, 1)]
        )
    regions.insert(
        0,
        {
            "id": org_id,
            "label": nodes.get(org_id, {}).get("label") or "",
            "href": nodes.get(org_id, {}).get("href"),
            "points": all_ring,
            "labelAt": [0.0, 0.0],
            "shape": "ring",
        },
    )

    # Islands already sit on a ring. Settle only when two discs actually overlap,
    # and keep the company node pinned so the radial map stays put.
    relax_islands(logical, home, regions, org_id)
    clear_all_halo(logical, home, regions, org_id, all_radius=all_radius)
    seat_shared_members(logical, member_of, regions, all_radius=all_radius)
    # A channel that only touches people has no island. Park it beside those
    # people instead of dropping it on the company logo.
    for node_id in list(linked):
        if node_id in logical or node_id == org_id:
            continue
        anchors = [
            logical[other]
            for other in neighbors.get(node_id, ())
            if other in logical
        ]
        if not anchors:
            logical[node_id] = (0.0, all_radius + 22.0)
            continue
        ax = sum(point[0] for point in anchors) / len(anchors)
        ay = sum(point[1] for point in anchors) / len(anchors)
        logical[node_id] = (ax + 28.0, ay)

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
    # The center node is the All root. Kind stays organization so the company
    # logo remains the puck and the name "All" never appears on the map.
    all_row = await ensure_all_department(session, tenant_id)
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

    org_id = f"department:{all_row.id}"
    add(org_id, "organization", tenant.name if tenant else "", "/team")
    dept_ids = {str(row.id) for row in departments}
    # Custom departments only. All's full roster is not drawn, or everyone
    # would leave their own island for the shared ring.
    for department in departments:
        dep = f"department:{department.id}"
        add(dep, "department", department.name, f"/communication/team/{department.id}")
        for member in await team_members(session, department):
            mid = f"{member.kind}:{member.id}"
            href = f"/agents/{member.id}" if member.kind == "agent" else "/team"
            add(mid, member.kind, member.duty, href)
            link(dep, mid)
    # Nest under the parent department when that parent is on the map.
    # Top-level departments parent to All, which is the center node.
    for department in departments:
        dep = f"department:{department.id}"
        parent_dep = f"department:{department.parent_id}" if department.parent_id else ""
        if parent_dep and parent_dep in nodes:
            link(dep, parent_dep)
        else:
            link(org_id, dep)

    user_ids = [UUID(node_id.split(":", 1)[1]) for node_id in nodes if node_id.startswith("user:")]
    user_rows = []
    if user_ids:
        user_rows = list((await session.execute(select(User).where(User.id.in_(user_ids)))).scalars().all())
    users = {str(row.id): (row.display_name or row.email or "").strip() for row in user_rows}
    # Bokito (acts_for_user) is the in-app helper, not a company org-map node.
    from app.services.workforce_runtime import company_agents

    agents = {str(row.id): row for row in await company_agents(session, tenant_id)}
    # Module specialists appear via department membership (or flow/stage owners),
    # not via managed_origin provenance — that was a parallel path into the map.
    for agent_id, agent in agents.items():
        node_id = f"agent:{agent_id}"
        if node_id in nodes:
            nodes[node_id]["label"] = agent.name
    for user_id, name in users.items():
        node = nodes.get(f"user:{user_id}")
        if node and name:
            node["label"] = name

    tags = list(
        (await session.execute(select(SignalTag).where(SignalTag.tenant_id == tenant_id))).scalars().all()
    )
    from app.services.workstreams import operator_flows

    flows = await operator_flows(session, tenant_id)
    folders = list(
        (
            await session.execute(select(Project).where(Project.tenant_id == tenant_id, Project.deleted_at.is_(None)))
        ).scalars().all()
    )
    for tag in tags:
        add(f"label:{tag.id}", "label", tag.name, f"/communication/tag/{tag.name}")
    for flow in flows:
        add(f"flow:{flow.id}", "flow", flow.name, f"/flows/{flow.id}")
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

    # ModuleAgent roster is tool ACL, not org structure — do not draw agent↔module.
    origin_depts = list(
        (
            await session.execute(
                select(Department).where(
                    Department.tenant_id == tenant_id,
                    Department.origin_module_slug.is_not(None),
                    Department.deleted_at.is_(None),
                )
            )
        ).scalars().all()
    )
    for dept in origin_depts:
        slug = dept.origin_module_slug or ""
        if not slug:
            continue
        add(f"module:{slug}", "module", slug, f"/connections/{slug}")
        if f"department:{dept.id}" in nodes:
            link(f"module:{slug}", f"department:{dept.id}")
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
        if not doc.project_id and not doc.agent_id and not doc.department_id:
            continue
        add(f"doc:{doc.id}", "doc", doc.title or doc.path, "/knowledge")
        if doc.project_id:
            link(f"doc:{doc.id}", f"folder:{doc.project_id}")
        if doc.agent_id:
            link(f"doc:{doc.id}", f"agent:{doc.agent_id}")
        if doc.department_id:
            link(f"doc:{doc.id}", f"department:{doc.department_id}")

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
    )
    from app.models.webhook import WebhookEndpoint

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
        elif grant.module_slug:
            slug = grant.module_slug
            add(f"module:{slug}", "module", slug, f"/connections/{slug}")
            link(f"module:{slug}", target)

    for account in accounts:
        if account.routing_user_id:
            link(f"channel:{account.id}", f"user:{account.routing_user_id}")
        elif account.routing_department_id:
            link(f"channel:{account.id}", f"department:{account.routing_department_id}")

    from app.services.tickets import parse_stages

    for flow in flows:
        for stage in parse_stages(flow.stages_json):
            owner = stage.get("owner")
            if owner:
                link(f"flow:{flow.id}", f"{owner['kind']}:{owner['id']}")

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
    _attach_marks(nodes, agents, user_rows, tags, accounts, calendars, connections, tenant)
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
        elif pair == {"department"}:
            relation = "hierarchy"
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
