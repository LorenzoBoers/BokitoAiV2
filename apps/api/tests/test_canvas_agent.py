"""Operator canvas tools stay available, and snapshot writes apply under Assisted."""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.auth import Tenant
from app.tools.policy import resolve_tool_mode
from app.tools.registry import (
    CANVAS_OPERATOR_TOOLS,
    PLATFORM_CORE_TOOLS,
    filter_tools_for_agent,
    get_tool_definitions,
    get_tool_spec,
    with_platform_core,
)


def test_canvas_chat_preview_keeps_stats_and_clips_charts():
    from app.services.proposal_items import canvas_chat_preview

    preview = canvas_chat_preview(
        {
            "type": "Stack",
            "props": {},
            "children": [
                {"type": "Stat", "props": {"title": "NPS", "value": "72"}, "children": []},
                {
                    "type": "BarChart",
                    "props": {
                        "title": "Week",
                        "series": [
                            {"name": "A", "points": [{"x": "1", "y": 1}, {"x": "2", "y": 2}, {"x": "3", "y": 3}, {"x": "4", "y": 4}, {"x": "5", "y": 5}]}
                        ],
                    },
                    "children": [],
                },
            ],
        }
    )
    assert preview is not None
    assert preview["children"][0]["type"] == "Stat"
    points = preview["children"][1]["props"]["series"][0]["points"]
    assert len(points) == 4
    assert canvas_chat_preview({"type": "Stack", "props": {}, "children": []}) is None


def test_narrow_passport_still_gets_canvas_tools():
    agent = SimpleNamespace(tools_json=json.dumps(["call_mcp_tool"]))
    narrowed = filter_tools_for_agent(get_tool_definitions(), agent)
    names = {tool["name"] for tool in narrowed}
    assert "create_canvas" not in names
    assert "call_mcp_tool" in names

    operator = {tool["name"] for tool in with_platform_core(narrowed, trust="operator")}
    assert PLATFORM_CORE_TOOLS <= operator
    assert CANVAS_OPERATOR_TOOLS <= operator
    assert {"update_progress", "react_to_message", "list_departments", "list_folders"} <= operator

    external = {tool["name"] for tool in with_platform_core(narrowed, trust="external")}
    assert external == {"call_mcp_tool", "list_mcp_tools"}

    refresh = {tool["name"] for tool in with_platform_core(narrowed, trust="operator", refresh=True)}
    assert "update_folder_canvas" in refresh
    assert "edit_canvas" in refresh
    assert "create_canvas" not in refresh
    assert "finish_canvas" not in refresh
    assert "update_progress" not in refresh


def test_module_seat_keeps_workspace_core():
    """A module expert's passport lists its specialty; folders are still the workspace."""
    from app.tools.registry import core_tool_names
    from app.services.workforce_runtime import ROLE_TOOL_TEMPLATES

    seat = SimpleNamespace(tools_json=json.dumps(list(ROLE_TOOL_TEMPLATES["module_specialist"])))
    offered = {
        t["name"]
        for t in with_platform_core(filter_tools_for_agent(get_tool_definitions(), seat), trust="operator")
    }
    assert {"list_folders", "create_folder", "list_folder_docs", "list_contacts"} <= offered
    assert "list_folders" in core_tool_names("operator")
    assert not core_tool_names("external")


def test_revision_canvas_edits_the_only_one_of_that_kind():
    from app.tools.project_work import existing_canvas_of_kind, revision_canvas

    listed = [
        {"id": "dash", "kind": "dashboard", "title": "Random Cijfers"},
        {"id": "note", "kind": "document", "title": "Notitie"},
    ]
    body = {"kind": "dashboard", "title": "Nieuwe grafieken", "source": "<Stack />"}
    assert revision_canvas(listed, body)["id"] == "dash"
    assert revision_canvas(listed, {**body, "force_new": True}) is None
    assert revision_canvas(listed, {**body, "kind": "document"})["id"] == "note"
    assert revision_canvas(listed, {"kind": "dashboard", "title": "Leeg"}) is None
    assert existing_canvas_of_kind(listed, {"kind": "dashboard", "title": "Leeg"})["id"] == "dash"
    assert existing_canvas_of_kind(listed, {"kind": "dashboard", "force_new": True}) is None
    two = listed + [{"id": "dash-2", "kind": "dashboard", "title": "Andere"}]
    assert revision_canvas(two, body) is None


def test_canvas_refresh_trigger_detects_wake_copy():
    from app.services.project_canvas import is_canvas_refresh_trigger

    assert is_canvas_refresh_trigger("Refresh canvas · Board", "")
    assert is_canvas_refresh_trigger("Write canvas · Board", "")
    assert is_canvas_refresh_trigger("Check-in", "Write or refresh snapshot canvas 'Board'")
    assert not is_canvas_refresh_trigger("Workspace nalopen", "Look at connections")


@pytest.mark.asyncio
async def test_canvas_writes_apply_unless_manual(client: AsyncClient, session_override):
    from scripts.seed import TEST_EMAIL, TEST_PASSWORD

    login = await client.post(
        "/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD}
    )
    assert login.status_code == 200
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    create = get_tool_spec("create_canvas")
    update = get_tool_spec("update_folder_canvas")
    delete = get_tool_spec("delete_canvas")
    assert create and update and delete

    mode, reason = await resolve_tool_mode(session_override, tenant, None, create)
    assert mode == "allow"
    assert reason == "canvas_snapshot"
    mode, reason = await resolve_tool_mode(session_override, tenant, None, update)
    assert mode == "allow"
    assert reason == "canvas_snapshot"
    mode, reason = await resolve_tool_mode(session_override, tenant, None, delete)
    assert mode == "ask"

    manual_agent = SimpleNamespace(autonomy_level="manual", settings_json="{}")
    mode, _reason = await resolve_tool_mode(session_override, tenant, manual_agent, create)
    assert mode == "ask"

    autonomous = SimpleNamespace(autonomy_level="autonomous", settings_json="{}")
    mode, _reason = await resolve_tool_mode(session_override, tenant, autonomous, delete)
    assert mode == "allow"

    settings = json.loads(tenant.settings_json or "{}")
    settings["autonomy_posture"] = "manual"
    tenant.settings_json = json.dumps(settings)
    session_override.add(tenant)
    await session_override.commit()
    session_override.expire_all()
    tenant = (await session_override.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()
    mode, reason = await resolve_tool_mode(session_override, tenant, autonomous, create)
    assert mode == "ask"
    assert reason == "canvas_manual"
