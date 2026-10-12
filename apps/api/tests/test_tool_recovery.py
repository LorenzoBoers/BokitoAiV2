"""Hung or crashed tools return a result to the model instead of killing the turn."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.services.agent.turn import _is_error
from app.tools.executor import TOOL_TIMEOUT_SECONDS, _invoke_handler, execute_tool


@pytest.mark.asyncio
async def test_execute_tool_timeout_returns_to_caller(session_override, monkeypatch):
    async def _hang(*_args, **_kwargs):
        await asyncio.sleep(5)

    monkeypatch.setattr("app.tools.executor._execute_tool", _hang)
    monkeypatch.setattr("app.tools.executor.TOOL_TIMEOUT_SECONDS", 0.05)
    result = await execute_tool(session_override, uuid4(), None, "update_folder_canvas", {})
    assert result["status"] == "timeout"
    assert "timed out" in result["error"]
    assert result["hint"]


@pytest.mark.asyncio
async def test_invoke_handler_returns_http_and_crash_to_model(session_override):
    ctx = SimpleNamespace()
    bad = SimpleNamespace(handler=AsyncMock(side_effect=HTTPException(400, "bad canvas")))
    invalid = await _invoke_handler(session_override, bad, ctx, {})
    assert invalid["status"] == "invalid"
    assert invalid["error"] == "bad canvas"

    boom = SimpleNamespace(handler=AsyncMock(side_effect=HTTPException(500, "store down")))
    server = await _invoke_handler(session_override, boom, ctx, {})
    assert server["status"] == "error"
    assert "store down" in server["error"]

    crash = SimpleNamespace(handler=AsyncMock(side_effect=RuntimeError("db locked")))
    failed = await _invoke_handler(session_override, crash, ctx, {})
    assert failed["status"] == "error"
    assert "db locked" in failed["error"]


def test_timeout_and_invalid_mark_activity_error():
    assert _is_error({"error": "took too long", "status": "timeout"})
    assert _is_error({"status": "timeout"})
    assert _is_error({"status": "invalid"})
    assert TOOL_TIMEOUT_SECONDS == 60
