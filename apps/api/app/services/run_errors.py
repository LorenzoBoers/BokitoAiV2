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

from app.core.time import utcnow
from app.exceptions import AppError

BLOCK_SPEND_CAP = "spend_cap"
BLOCK_PROVIDER_CREDITS = "provider_credits"
BLOCK_PROVIDER_AUTH = "provider_auth"
BLOCK_RATE_LIMIT = "rate_limit"

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
_RATE_MARKERS = (
    "rate limit",
    "rate_limited",
    "error code: 429",
    "'code': '1300'",
    '"code": "1300"',
)

# Short pause so inbound jobs stop hammering a hot gateway; chat retries first.
LLM_RATE_LIMIT_BACKOFF_MINUTES = 5


def workspace_block(exc: BaseException) -> str | None:
    """Return the block kind when the failure stops every run in the workspace."""
    if isinstance(exc, AppError) and exc.code == "budget_exceeded":
        return BLOCK_SPEND_CAP
    text = str(exc).lower()
    if any(marker in text for marker in _CREDIT_MARKERS):
        return BLOCK_PROVIDER_CREDITS
    if any(marker in text for marker in _AUTH_MARKERS):
        return BLOCK_PROVIDER_AUTH
    if type(exc).__name__ == "RateLimitError" or any(marker in text for marker in _RATE_MARKERS):
        return BLOCK_RATE_LIMIT
    return None


def error_summary(exc: BaseException) -> str:
    return (str(exc) or type(exc).__name__)[:1000]


def failure_brief(exc: BaseException | None) -> str:
    """One line an agent can act on. Internal driver errors stay off the thread."""
    text = " ".join(str(exc or "").split())
    lowered = text.lower()
    if "greenlet_spawn" in lowered or "missinggreenlet" in lowered:
        return "a tool call failed while saving its result"
    if isinstance(exc, TimeoutError) or "timed out" in lowered:
        return "the reply took too long to finish"
    if "sqlalche.me" in lowered or "traceback" in lowered:
        return "an internal error interrupted the reply"
    return text[:180] or "an internal error interrupted the reply"


# ── workspace-wide circuit breaker ─────────────────────────────────
#
# Once a block is seen, inbound processing stops starting runs for a while
# instead of failing one run per email (one tenant logged 222 failed runs on
# the same "credit balance too low" error). Deferred threads are re-queued
# when the block lifts.

LLM_BLOCK_SETTINGS_KEY = "llm_block"
LLM_BLOCK_BACKOFF_MINUTES = 60
LLM_BLOCK_MAX_DEFERRED = 500

_BLOCK_BACKOFF_MINUTES = {
    BLOCK_RATE_LIMIT: LLM_RATE_LIMIT_BACKOFF_MINUTES,
}


def _settings_of(tenant: Any) -> dict[str, Any]:
    try:
        data = json.loads(getattr(tenant, "settings_json", None) or "{}")
    except (TypeError, json.JSONDecodeError):
        data = {}
    return data if isinstance(data, dict) else {}


def _next_utc_midnight(now: datetime) -> datetime:
    tomorrow = now + timedelta(days=1)
    return tomorrow.replace(hour=0, minute=0, second=0, microsecond=0)


def _next_utc_month_start(now: datetime) -> datetime:
    if now.month == 12:
        return now.replace(year=now.year + 1, month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    return now.replace(month=now.month + 1, day=1, hour=0, minute=0, second=0, microsecond=0)


def block_until(kind: str, error: BaseException | str, *, now: datetime | None = None) -> datetime:
    """When inbound/triggers may try again after this block kind."""
    stamp = now or utcnow()
    if kind == BLOCK_SPEND_CAP:
        # Daily token cap resets at UTC midnight; monthly at month start.
        # A 60-minute window reopened one failed email run every hour.
        text = str(error or "").lower()
        if "monthly" in text:
            return _next_utc_month_start(stamp)
        return _next_utc_midnight(stamp)
    minutes = _BLOCK_BACKOFF_MINUTES.get(kind, LLM_BLOCK_BACKOFF_MINUTES)
    return stamp + timedelta(minutes=minutes)


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
    if until is None or (now or utcnow()) >= until:
        return None
    return block


def open_workspace_block(tenant: Any, *, kind: str, error: BaseException | str) -> dict[str, Any]:
    """Start (or extend) the block; caller adds the tenant to the session."""
    now = utcnow()
    settings = _settings_of(tenant)
    previous = settings.get(LLM_BLOCK_SETTINGS_KEY)
    previous = previous if isinstance(previous, dict) else {}
    until = block_until(kind, error, now=now)
    # Extending an open block must not shrink the window (e.g. spend_cap → midnight).
    try:
        previous_until = (
            datetime.fromisoformat(str(previous.get("until")))
            if previous.get("until")
            else None
        )
    except ValueError:
        previous_until = None
    if previous_until is not None and previous_until > until and previous.get("kind") == kind:
        until = previous_until
    block = {
        "kind": kind,
        "error": (str(error) or kind)[:500],
        "since": previous.get("since") or now.isoformat(),
        "until": until.isoformat(),
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


def record_run_failure(
    run: Any,
    message: str,
    *,
    error_code: str | None = None,
) -> None:
    """Merge a plain failure note into ``run.result_json`` (caller commits)."""
    try:
        data = json.loads(run.result_json or "{}")
    except (TypeError, json.JSONDecodeError):
        data = {}
    if not isinstance(data, dict):
        data = {}
    text = " ".join(str(message or "").split())[:1000] or "run failed"
    data["error"] = text
    if error_code:
        data["error_code"] = error_code
    run.result_json = json.dumps(data)
    if not getattr(run, "stop_reason", None):
        run.stop_reason = "error"


def record_run_error(run: Any, exc: BaseException) -> None:
    """Merge ``error`` / ``error_code`` into ``run.result_json`` (caller commits)."""
    block = workspace_block(exc)
    code = block
    if code is None and isinstance(exc, AppError):
        code = exc.code
    record_run_failure(run, error_summary(exc), error_code=code)
