"""Per-channel AI helpers that are not AI handling.

How the AI treats a conversation (autonomous / assisted / manual) lives in
``app.services.ai_handling``. This module keeps the inbox policy read by
triage and the mailbox ``ai_config`` reader used by the language policy.
"""

from __future__ import annotations

from app.models.auth import Tenant
from app.services.ai_handling import DEFAULT_CERTAINTY_THRESHOLD, account_ai_config, workspace_settings

__all__ = ["DEFAULT_CERTAINTY_THRESHOLD", "account_ai_config", "inbox_policy"]


def inbox_policy(tenant: Tenant | None) -> dict:
    """``certainty_threshold`` (1-10): triage below it never raises priority and
    an autonomous reply below it is downgraded to a draft."""
    return {"certainty_threshold": workspace_settings(tenant)["safeguards"]["certainty_threshold"]}
