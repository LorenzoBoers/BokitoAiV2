"""Per-channel AI mode: how the AI handles inbound customer messages.

One knob replaces the scattered `suggestions_enabled` / auto-reply flags:

- ``suggest`` — the agent drafts a reply as an inline DecisionRequest card;
  a human approves, edits, or escalates. Nothing is sent automatically.
- ``auto`` — the agent replies directly (delivered externally where the
  channel supports it; widget/chat visitors see it live via the gateway).
- ``off`` — no AI processing; humans handle the thread.

Resolution order: channel-account ``ai_config.mode`` -> tenant
``channel_ai_modes[channel]`` -> built-in default. Human takeover
(``Signal.ai_paused``) always wins over any mode.
"""

from __future__ import annotations

import json

from app.models.auth import Tenant
from app.models.channel import ChannelAccount

AI_MODES = ("suggest", "auto", "off")

_CHANNEL_DEFAULTS = {
    "email": "suggest",
    "widget": "auto",
    "chat": "auto",
}
_FALLBACK_MODE = "suggest"


def default_ai_mode(channel: str) -> str:
    return _CHANNEL_DEFAULTS.get(channel, _FALLBACK_MODE)


def account_ai_config(account: ChannelAccount | None) -> dict:
    if account is None:
        return {}
    try:
        settings_obj = json.loads(account.settings_json or "{}")
    except json.JSONDecodeError:
        return {}
    ai_config = settings_obj.get("ai_config")
    return ai_config if isinstance(ai_config, dict) else {}


def tenant_channel_ai_modes(tenant: Tenant | None) -> dict:
    if tenant is None:
        return {}
    try:
        settings_obj = json.loads(tenant.settings_json or "{}")
    except json.JSONDecodeError:
        return {}
    modes = settings_obj.get("channel_ai_modes")
    return modes if isinstance(modes, dict) else {}


def resolve_ai_mode(
    tenant: Tenant | None,
    account: ChannelAccount | None,
    channel: str,
) -> str:
    """Resolve the effective AI mode for a channel (account overrides tenant)."""
    ai_config = account_ai_config(account)
    mode = ai_config.get("mode")
    if mode in AI_MODES:
        return mode
    # Legacy per-mailbox flag written by older AI settings UIs.
    if ai_config.get("suggestions_enabled") is False:
        return "off"

    tenant_mode = tenant_channel_ai_modes(tenant).get(channel)
    if tenant_mode in AI_MODES:
        return tenant_mode
    return default_ai_mode(channel)
