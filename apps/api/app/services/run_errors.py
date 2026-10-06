"""Classify and record agent run failures.

Workspace-wide blocks (spend cap reached, provider credits exhausted, provider
key rejected) hit every run until someone fixes them. They are recorded on the
run like any failure, but callers alert once per block instead of once per
message, and inbound processing stops instead of retrying.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta
from typing import Any

from app.exceptions import AppError

BLOCK_SPEND_CAP = "spend_cap"
BLOCK_PROVIDER_CREDITS = "provider_credits"
BLOCK_PROVIDER_AUTH = "provider_auth"

_CREDIT_MARKERS = (
    "credit balance is too low",
    "insufficient_quota",
    "exceeded your current quota",
    "billing",
)
_AUTH_MARKERS = (
    "invalid x-api-key",
    "invalid api key",
    "incorrect api key",
    "authentication_error",
)


def workspace_block(exc: BaseException) -> str | None:
    """Return the block kind when the failure stops every run in the workspace."""
    if isinstance(exc, AppError) and exc.code == "budget_exceeded":
        return BLOCK_SPEND_CAP
    text = str(exc).lower()
    if any(marker in text for marker in _CREDIT_MARKERS):
        return BLOCK_PROVIDER_CREDITS
    if any(marker in text for marker in _AUTH_MARKERS):
        return BLOCK_PROVIDER_AUTH
    return None


def error_summary(exc: BaseException) -> str:
    return (str(exc) or type(exc).__name__)[:1000]


# ── workspace-wide circuit breaker ─────────────────────────────────
#
# Once a block is seen, inbound processing stops starting runs for a while
# instead of failing one run per email (one tenant logged 222 failed runs on
# the same "credit balance too low" error). Deferred threads are re-queued
# when the block lifts.

LLM_BLOCK_SETTINGS_KEY = "llm_block"
LLM_BLOCK_BACKOFF_MINUTES = 60
LLM_BLOCK_MAX_DEFERRED = 500


def _settings_of(tenant: Any) -> dict[str, Any]:
    try:
        data = json.loads(getattr(tenant, "settings_json", None) or "{}")
    except (TypeError, json.JSONDecodeError):
        data = {}
    return data if isinstance(data, dict) else {}


def active_workspace_block(tenant: Any, *, now: datetime | None = None) -> dict[str, Any] | None:
    """The current block when its backoff window has not passed yet."""
    block = _settings_of(tenant).get(LLM_BLOCK_SETTINGS_KEY)
    if not isinstance(block, dict) or not block.get("kind"):
        return None
    until_raw = block.get("until")
    try:
        until = datetime.fromisoformat(str(until_raw)) if until_raw else None
    except ValueError:
        until = None
    if until is None or (now or datetime.utcnow()) >= until:
        return None
    return block


def open_workspace_block(tenant: Any, *, kind: str, error: BaseException | str) -> dict[str, Any]:
    """Start (or extend) the block; caller adds the tenant to the session."""
    now = datetime.utcnow()
    settings = _settings_of(tenant)
    previous = settings.get(LLM_BLOCK_SETTINGS_KEY)
    previous = previous if isinstance(previous, dict) else {}
    block = {
        "kind": kind,
        "error": (str(error) or kind)[:500],
        "since": previous.get("since") or now.isoformat(),
        "until": (now + timedelta(minutes=LLM_BLOCK_BACKOFF_MINUTES)).isoformat(),
        "deferred_signal_ids": list(previous.get("deferred_signal_ids") or []),
    }
    settings[LLM_BLOCK_SETTINGS_KEY] = block
    tenant.settings_json = json.dumps(settings)
    return block


def defer_signal_during_block(tenant: Any, signal_id: Any) -> None:
    """Remember a thread skipped while blocked so it can be re-triaged later."""
    settings = _settings_of(tenant)
    block = settings.get(LLM_BLOCK_SETTINGS_KEY)
    if not isinstance(block, dict):
        return
    deferred = [str(x) for x in block.get("deferred_signal_ids") or []]
    sid = str(signal_id)
    if sid not in deferred:
        deferred.append(sid)
    block["deferred_signal_ids"] = deferred[-LLM_BLOCK_MAX_DEFERRED:]
    settings[LLM_BLOCK_SETTINGS_KEY] = block
    tenant.settings_json = json.dumps(settings)


def close_workspace_block(tenant: Any) -> list[str]:
    """Clear the block and hand back the threads that were deferred under it."""
    settings = _settings_of(tenant)
    block = settings.pop(LLM_BLOCK_SETTINGS_KEY, None)
    tenant.settings_json = json.dumps(settings)
    if not isinstance(block, dict):
        return []
    return [str(x) for x in block.get("deferred_signal_ids") or []]


def record_run_error(run: Any, exc: BaseException) -> None:
    """Merge ``error`` / ``error_code`` into ``run.result_json`` (caller commits)."""
    try:
        data = json.loads(run.result_json or "{}")
    except (TypeError, json.JSONDecodeError):
        data = {}
    if not isinstance(data, dict):
        data = {}
    data["error"] = error_summary(exc)
    block = workspace_block(exc)
    if block:
        data["error_code"] = block
    elif isinstance(exc, AppError):
        data["error_code"] = exc.code
    run.result_json = json.dumps(data)
