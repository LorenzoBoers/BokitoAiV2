"""Classify and record agent run failures.

Workspace-wide blocks (spend cap reached, provider credits exhausted, provider
key rejected) hit every run until someone fixes them. They are recorded on the
run like any failure, but callers alert once per block instead of once per
message, and inbound processing stops instead of retrying.
"""

from __future__ import annotations

import json
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
