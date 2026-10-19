"""Canvas destinations stay a pure function of node kind."""

import math
from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.auth import Tenant, User
from app.models.module_agent import AgentScope
from app.services.org_graph import (
    ALL_AREA_RADIUS,
    MEMBER_CLEARANCE,
    MEMBER_CORRIDOR,
    build_org_graph,
    channel_href,
    clear_all_halo,
    cluster_disc,
    collapse_label_bridges,
    iso_point,
    region_span,
    relax_islands,
    seat_shared_members,
)
from app.services.personal_assistant import ensure_personal_assistant
from scripts.seed import TEST_EMAIL


def test_company_logo_keeps_the_stored_brand_file():
    from app.services.org_graph import _company_logo_url

    tenant = Tenant(slug="bokito", name="Bokito AI", logo_url="/bokito-logo.png")
    assert _company_logo_url(tenant) == "/bokito-logo.png"


def test_channel_href_mailbox_uses_the_connection():
    connection_id = uuid4()
    assert channel_href("email", connection_id) == f"/communication/channel/email/{connection_id}"


def test_channel_href_widget_opens_webchat():
    assert channel_href("widget", None) == "/communication/channel/webchat"


def test_channel_href_unknown_opens_connections():
    assert channel_href("sms", None) == "/connections"


def test_cluster_disc_keeps_a_link_shorter_than_a_stranger():
    """A linked pair shares a slice. An unlinked item sits in its own slice."""
    placed = cluster_disc(
        ["hub", "doc", "stray"],
        [("hub", "doc")],
        0.0,
        0.0,
        0.0,
        40.0,
        80.0,
    )
    hx, hy = placed["hub"]
    dx, dy = placed["doc"]
    sx, sy = placed["stray"]
    linked = math.hypot(hx - dx, hy - dy)
    stranger = math.hypot(hx - sx, hy - sy)
    assert linked < stranger
    assert math.hypot(hx, hy) > 10


def test_region_grows_with_chips_and_iso_is_stable():
    narrow = region_span(1)
    wide = region_span(6)
    assert wide[2] > narrow[2]
    assert wide[3] > narrow[3]
    assert iso_point(100, 40) == iso_point(100, 40)
    assert iso_point(0, 0) == (0.0, 0.0)


def _disc(cx: float, cy: float, radius: float) -> list[list[float]]:
    return [
        [cx + radius, cy],
        [cx, cy + radius],
        [cx - radius, cy],
        [cx, cy - radius],
    ]


def test_seat_shared_members_sits_between_all_and_departments():
    logical = {
        "department:all": (0.0, 0.0),
        "department:a": (0.0, 200.0),
        "department:b": (200.0, 0.0),
        "agent:1": (20.0, 75.0),
        "user:2": (0.0, 180.0),
    }
    regions = [
        {"id": "department:a", "points": _disc(0, 200, 40)},
        {"id": "department:b", "points": _disc(200, 0, 40)},
    ]
    seat_shared_members(
        logical,
        {"agent:1": {"department:a", "department:b"}, "user:2": {"department:a"}},
        regions,
    )
    ax, ay = logical["agent:1"]
    assert math.hypot(ax, ay) > 64
    assert math.hypot(ax - 0, ay - 200) > 40
    assert math.hypot(ax - 200, ay - 0) > 40
    ux, uy = logical["user:2"]
    assert abs(ux) < 1
    assert 64 < uy < 160
    assert logical["department:all"] == (0.0, 0.0)


def test_seat_shared_members_spreads_people_on_the_same_island():
    logical = {
        "department:all": (0.0, 0.0),
        "department:a": (0.0, 220.0),
        "agent:boekito": (0.0, 40.0),
        "agent:assistant": (0.0, 40.0),
    }
    regions = [{"id": "department:a", "points": _disc(0, 220, 50)}]
    seat_shared_members(
        logical,
        {"agent:boekito": {"department:a"}, "agent:assistant": {"department:a"}},
        regions,
    )
    ax, ay = logical["agent:boekito"]
    bx, by = logical["agent:assistant"]
    assert math.hypot(ax - bx, ay - by) >= MEMBER_CLEARANCE - 0.1
    assert math.hypot(ax, ay) > 64
    assert math.hypot(bx, by) > 64


def test_clear_all_halo_opens_a_corridor():
    """A fat island near the logo slides out until the member band is free."""
    logical = {
        "department:all": (0.0, 0.0),
        "department:a": (0.0, 150.0),
        "doc:1": (8.0, 190.0),
    }
    home = {"department:a": "department:a", "doc:1": "department:a"}
    regions = [{"id": "department:a", "points": _disc(0, 150, 100), "labelAt": [0.0, 150.0]}]
    clear_all_halo(logical, home, regions, "department:all")
    dist = math.hypot(*logical["department:a"])
    assert dist - 100 >= ALL_AREA_RADIUS + MEMBER_CORRIDOR - 1
    assert logical["doc:1"][1] > 190
    assert logical["department:all"] == (0.0, 0.0)
    assert regions[0]["labelAt"][1] == round(logical["department:a"][1], 1)


def test_relax_islands_leaves_a_separated_ring_in_place():
    """Far islands and the company center do not move."""
    logical = {
        "department:all": (0.0, 0.0),
        "department:a": (0.0, 200.0),
        "department:b": (200.0, 0.0),
    }
    home = {
        "department:all": "overview",
        "department:a": "department:a",
        "department:b": "department:b",
        "agent:1": "department:a",
    }
    logical["agent:1"] = (12.0, 230.0)
    regions = [
        {"id": "department:a", "points": _disc(0, 200, 40), "labelAt": [0.0, 200.0]},
        {"id": "department:b", "points": _disc(200, 0, 40), "labelAt": [200.0, 0.0]},
    ]
    assert relax_islands(logical, home, regions, "department:all") is False
    assert logical["department:all"] == (0.0, 0.0)
    assert logical["department:a"] == (0.0, 200.0)
    assert logical["agent:1"] == (12.0, 230.0)


def test_relax_islands_pushes_overlapping_discs_apart():
    logical = {
        "department:all": (0.0, 0.0),
        "department:a": (0.0, 0.0),
        "department:b": (40.0, 0.0),
    }
    home = {"department:a": "department:a", "department:b": "department:b", "user:1": "department:a"}
    logical["user:1"] = (10.0, 0.0)
    regions = [
        {"id": "department:a", "points": _disc(0, 0, 80), "labelAt": [0.0, 0.0]},
        {"id": "department:b", "points": _disc(40, 0, 80), "labelAt": [40.0, 0.0]},
    ]
    assert relax_islands(logical, home, regions, "department:all") is True
    ax, ay = logical["department:a"]
    bx, by = logical["department:b"]
    assert (ax - bx) ** 2 + (ay - by) ** 2 > 40**2
    assert logical["department:all"] == (0.0, 0.0)
    assert logical["user:1"][0] != 10.0 or logical["user:1"][1] != 0.0


def test_collapse_label_bridges_draws_direct_lines():
    """Label chips leave the map; flow—folder (via #tag) becomes one edge."""
    nodes = {
        "flow:1": {"id": "flow:1", "kind": "flow", "label": "Bugs"},
        "label:9": {"id": "label:9", "kind": "label", "label": "#bugs"},
        "folder:2": {"id": "folder:2", "kind": "folder", "label": "Product"},
        "department:3": {"id": "department:3", "kind": "department", "label": "Support"},
    }
    links = [
        ("flow:1", "label:9"),
        ("label:9", "folder:2"),
        ("department:3", "label:9"),
    ]
    bridged = collapse_label_bridges(nodes, links)
    assert "label:9" not in nodes
    pairs = {tuple(sorted(pair)) for pair in bridged}
    assert ("flow:1", "folder:2") in pairs
    assert ("department:3", "flow:1") in pairs
    assert ("department:3", "folder:2") in pairs
    assert not any("label:" in a or "label:" in b for a, b in bridged)


@pytest.mark.asyncio
async def test_org_graph_excludes_personal_assistant(client: AsyncClient, session_override):
    """Bokito (acts_for_user) stays off the organization map, even with scopes."""
    tenant = (await session_override.execute(select(Tenant))).scalars().first()
    user = (
        await session_override.execute(select(User).where(User.email == TEST_EMAIL))
    ).scalars().first()
    assert tenant is not None and user is not None
    helper = await ensure_personal_assistant(session_override, tenant.id, commit=True)
    session_override.add(
        AgentScope(
            tenant_id=tenant.id,
            agent_id=helper.id,
            resource_kind="knowledge",
            resource_id=str(user.id),
        )
    )
    await session_override.commit()

    graph = await build_org_graph(session_override, tenant.id)
    agent_ids = {node["id"] for node in graph["nodes"] if node["kind"] == "agent"}
    assert f"agent:{helper.id}" not in agent_ids


@pytest.mark.asyncio
async def test_org_graph_module_specialist_sits_on_department(client: AsyncClient, session_override):
    """Module roster / managed provenance do not draw agent↔module; department does."""
    from app.models.agent import Agent
    from app.models.team import DepartmentMember
    from app.services.module_agents import add_module_agent
    from app.services.module_department import bind_module_department

    del client
    tenant = (await session_override.execute(select(Tenant))).scalars().first()
    assert tenant is not None
    department = await bind_module_department(session_override, tenant.id, "accounting")

    specialist = Agent(
        tenant_id=tenant.id,
        name="Accounting Specialist",
        role="module_specialist",
        slug="module-accounting",
        chat_access="everyone",
        runtime_status="standby",
        system_prompt="Books",
        is_active=True,
    )
    session_override.add(specialist)
    await session_override.commit()
    await session_override.refresh(specialist)

    await add_module_agent(session_override, tenant.id, "accounting", specialist.id, is_default=True)
    session_override.add(
        DepartmentMember(
            tenant_id=tenant.id,
            department_id=department.id,
            member_kind="agent",
            agent_id=specialist.id,
            position=0,
        )
    )
    await session_override.commit()

    graph = await build_org_graph(session_override, tenant.id)
    agent_node = f"agent:{specialist.id}"
    module_node = "module:accounting"
    dept_node = f"department:{department.id}"
    link_pairs = {
        tuple(sorted((edge["source"], edge["target"])))
        for edge in graph["edges"]
    }

    assert agent_node in {n["id"] for n in graph["nodes"]}
    assert module_node in {n["id"] for n in graph["nodes"]}
    assert tuple(sorted((agent_node, dept_node))) in link_pairs
    assert tuple(sorted((module_node, dept_node))) in link_pairs
    assert tuple(sorted((agent_node, module_node))) not in link_pairs


@pytest.mark.asyncio
async def test_org_graph_department_hierarchy_edge(client: AsyncClient, session_override):
    """Nested custom departments link with kind hierarchy, not an org spoke each."""
    from app.models.team import Department
    from app.services.teams import ensure_all_department

    del client
    tenant = (await session_override.execute(select(Tenant))).scalars().first()
    assert tenant is not None
    root = await ensure_all_department(session_override, tenant.id)
    parent = Department(
        tenant_id=tenant.id,
        name="Parent Ops",
        parent_id=root.id,
        kind="custom",
    )
    session_override.add(parent)
    await session_override.commit()
    await session_override.refresh(parent)
    child = Department(
        tenant_id=tenant.id,
        name="Child Desk",
        parent_id=parent.id,
        kind="custom",
    )
    session_override.add(child)
    await session_override.commit()
    await session_override.refresh(child)

    graph = await build_org_graph(session_override, tenant.id)
    parent_node = f"department:{parent.id}"
    child_node = f"department:{child.id}"
    org_node = f"department:{root.id}"

    by_pair = {
        tuple(sorted((edge["source"], edge["target"]))): edge["kind"]
        for edge in graph["edges"]
    }
    assert by_pair[tuple(sorted((parent_node, child_node)))] == "hierarchy"
    assert by_pair[tuple(sorted((org_node, parent_node)))] == "org"
    assert tuple(sorted((org_node, child_node))) not in by_pair
    org = next(node for node in graph["nodes"] if node["kind"] == "organization")
    assert org["id"] == org_node
    assert org["label"] != "All"
    assert org["x"] == 0 and org["y"] == 0
    assert not any(node["label"] == "All" for node in graph["nodes"])
    all_region = next(region for region in graph["regions"] if region["id"] == org_node)
    assert all_region["shape"] == "ring"
    assert all_region["label"] != "All"
    assert org["mark"].get("provider") != "bokito"
    assert not org["mark"].get("avatar_image_url")

    tenant.logo_url = "data:image/png;base64,abc"
    await session_override.commit()
    graph = await build_org_graph(session_override, tenant.id)
    org = next(node for node in graph["nodes"] if node["kind"] == "organization")
    assert org["mark"]["avatar_image_url"] == "data:image/png;base64,abc"
    tenant.logo_url = None
    await session_override.commit()


@pytest.mark.asyncio
async def test_org_graph_all_only_item_sits_on_center(client: AsyncClient, session_override):
    """A folder homed only on All lands on the center island, not a spare plot."""
    from app.models.project import Project
    from app.services.teams import ensure_all_department

    del client
    tenant = (await session_override.execute(select(Tenant))).scalars().first()
    assert tenant is not None
    root = await ensure_all_department(session_override, tenant.id)
    folder = Project(
        tenant_id=tenant.id,
        name="Company handbook",
        slug="company-handbook-all",
        department_id=root.id,
    )
    session_override.add(folder)
    await session_override.commit()
    await session_override.refresh(folder)

    graph = await build_org_graph(session_override, tenant.id)
    org_node = f"department:{root.id}"
    placed = next(node for node in graph["nodes"] if node["id"] == f"folder:{folder.id}")
    assert placed["region"] == org_node
    assert (placed["x"] ** 2 + placed["y"] ** 2) ** 0.5 < 90
    assert any(region["id"] == org_node for region in graph["regions"])
