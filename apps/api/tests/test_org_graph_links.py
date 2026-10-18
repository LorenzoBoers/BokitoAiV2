"""Canvas destinations stay a pure function of node kind."""

from uuid import uuid4

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.auth import Tenant, User
from app.models.module_agent import AgentScope
from app.services.org_graph import (
    build_org_graph,
    channel_href,
    collapse_label_bridges,
    iso_point,
    region_span,
)
from app.services.personal_assistant import ensure_personal_assistant
from scripts.seed import TEST_EMAIL


def test_channel_href_mailbox_uses_the_connection():
    connection_id = uuid4()
    assert channel_href("email", connection_id) == f"/communication/channel/email/{connection_id}"


def test_channel_href_widget_opens_webchat():
    assert channel_href("widget", None) == "/communication/channel/webchat"


def test_channel_href_unknown_opens_connections():
    assert channel_href("sms", None) == "/connections"


def test_region_grows_with_chips_and_iso_is_stable():
    narrow = region_span(1)
    wide = region_span(6)
    assert wide[2] > narrow[2]
    assert wide[3] > narrow[3]
    assert iso_point(100, 40) == iso_point(100, 40)
    assert iso_point(0, 0) == (0.0, 0.0)


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
