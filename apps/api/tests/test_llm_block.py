"""Workspace LLM block: one failure opens a block, later threads are deferred,
and a successful turn re-queues them."""

import json
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, patch
from uuid import uuid4

from app.models.auth import Tenant
from app.services.run_errors import (
    LLM_BLOCK_BACKOFF_MINUTES,
    LLM_BLOCK_SETTINGS_KEY,
    active_workspace_block,
    close_workspace_block,
    defer_signal_during_block,
    open_workspace_block,
)


def test_block_opens_with_backoff_and_keeps_deferred_threads():
    tenant = Tenant(slug="blk", name="Block")
    assert active_workspace_block(tenant) is None

    block = open_workspace_block(tenant, kind="provider_credits", error=RuntimeError("credit balance too low"))
    assert block["kind"] == "provider_credits"
    assert "credit balance" in block["error"]
    assert active_workspace_block(tenant) is not None

    first, second = uuid4(), uuid4()
    defer_signal_during_block(tenant, first)
    defer_signal_during_block(tenant, second)
    defer_signal_during_block(tenant, first)  # no duplicates
    stored = json.loads(tenant.settings_json)[LLM_BLOCK_SETTINGS_KEY]
    assert stored["deferred_signal_ids"] == [str(first), str(second)]

    # Re-opening keeps the original start and the deferred list.
    again = open_workspace_block(tenant, kind="provider_credits", error="still broken")
    assert again["since"] == block["since"]
    assert again["deferred_signal_ids"] == [str(first), str(second)]


def test_block_expires_after_backoff_window():
    tenant = Tenant(slug="blk", name="Block")
    open_workspace_block(tenant, kind="spend_cap", error="cap")
    later = datetime.utcnow() + timedelta(minutes=LLM_BLOCK_BACKOFF_MINUTES + 1)
    assert active_workspace_block(tenant, now=later) is None
    # Expired but not yet closed: the deferred list is still there to release.
    assert LLM_BLOCK_SETTINGS_KEY in json.loads(tenant.settings_json)


def test_close_returns_deferred_and_clears_settings():
    tenant = Tenant(slug="blk", name="Block", settings_json=json.dumps({"keep": True}))
    open_workspace_block(tenant, kind="provider_auth", error="bad key")
    sid = uuid4()
    defer_signal_during_block(tenant, sid)

    deferred = close_workspace_block(tenant)
    assert deferred == [str(sid)]
    assert json.loads(tenant.settings_json) == {"keep": True}
    assert close_workspace_block(tenant) == []


async def test_release_requeues_deferred_threads(session_override):
    from app.workers.tasks import release_workspace_block

    session = session_override
    tenant = Tenant(slug="blk", name="Block")
    session.add(tenant)
    await session.commit()

    open_workspace_block(tenant, kind="provider_credits", error="credits")
    current, other = uuid4(), uuid4()
    defer_signal_during_block(tenant, current)
    defer_signal_during_block(tenant, other)
    session.add(tenant)
    await session.commit()

    with patch("app.workers.tasks.enqueue_signal_processing", new=AsyncMock()) as enqueue:
        count = await release_workspace_block(session, tenant, exclude_signal_id=str(current))

    assert count == 1
    enqueue.assert_awaited_once_with(str(tenant.id), str(other))
    await session.refresh(tenant)
    assert LLM_BLOCK_SETTINGS_KEY not in json.loads(tenant.settings_json or "{}")

    # No block: nothing to do.
    with patch("app.workers.tasks.enqueue_signal_processing", new=AsyncMock()) as enqueue:
        assert await release_workspace_block(session, tenant) == 0
    enqueue.assert_not_awaited()


def test_assisted_mode_keeps_module_reads_and_blocks_writes():
    from app.tools import builtin  # noqa: F401  (registers tools)
    from app.modules.catalog import ModuleToolCard
    from app.tools.module_tools import _register_card
    from app.workers.tasks import assisted_tool_allowed

    _register_card(
        "unit_acct",
        ModuleToolCard(verb="list_companies", label="List", description="d", kind="read"),
    )
    _register_card(
        "unit_acct",
        ModuleToolCard(verb="create_invoice", label="Create", description="d", kind="apply"),
    )
    assert assisted_tool_allowed("search_index")
    assert assisted_tool_allowed("unit_acct_list_companies")
    assert not assisted_tool_allowed("unit_acct_create_invoice")
    assert not assisted_tool_allowed("send_reply")
