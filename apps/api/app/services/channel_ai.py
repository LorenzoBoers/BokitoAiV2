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
    "whatsapp": "suggest",
}
_FALLBACK_MODE = "suggest"


DEFAULT_CERTAINTY_THRESHOLD = 7


def default_ai_mode(channel: str) -> str:
    return _CHANNEL_DEFAULTS.get(channel, _FALLBACK_MODE)


def _tenant_settings(tenant: Tenant | None) -> dict:
    if tenant is None:
        return {}
    try:
        settings_obj = json.loads(tenant.settings_json or "{}")
    except json.JSONDecodeError:
        return {}
    return settings_obj if isinstance(settings_obj, dict) else {}


def inbox_policy(tenant: Tenant | None) -> dict:
    """Tenant inbox policy from settings (was the inbox_settings table).

    - ``autonomous_reply``: legacy tenant-wide auto-reply switch.
    - ``certainty_threshold`` (1-10): triage below this certainty never
      raises thread priority.
    """
    raw = _tenant_settings(tenant).get("inbox")
    data = raw if isinstance(raw, dict) else {}
    try:
        threshold = int(data.get("certainty_threshold", DEFAULT_CERTAINTY_THRESHOLD))
    except (TypeError, ValueError):
        threshold = DEFAULT_CERTAINTY_THRESHOLD
    threshold = min(10, max(1, threshold))
    return {
        "autonomous_reply": bool(data.get("autonomous_reply")),
        "certainty_threshold": threshold,
    }


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
    modes = _tenant_settings(tenant).get("channel_ai_modes")
    return modes if isinstance(modes, dict) else {}


def _govern_clamp(tenant: Tenant | None, mode: str) -> str:
    """Channel AI mode is a view over the Govern messaging allowance.

    The allowance is the outer bound so a channel on "auto" can never send
    while Govern says "ask" (and "deny" switches AI off entirely). One policy
    engine, surfaced in two places.
    """
    if tenant is None or mode == "off":
        return mode
    from app.tools.policy import tenant_allowances

    allowance = tenant_allowances(tenant).get("messaging", "ask")
    if allowance == "deny":
        return "off"
    if allowance == "ask" and mode == "auto":
        return "suggest"
    return mode


def resolve_ai_mode(
    tenant: Tenant | None,
    account: ChannelAccount | None,
    channel: str,
) -> str:
    """Effective AI mode: account overrides tenant, Govern allowance clamps."""
    from app.services.privacy import tenant_allows_llm_message_bodies

    if tenant is not None and not tenant_allows_llm_message_bodies(tenant):
        # Privacy setting: do not send message bodies to LLM providers.
        return "off"

    ai_config = account_ai_config(account)
    mode = ai_config.get("mode")
    if mode in AI_MODES:
        return _govern_clamp(tenant, mode)
    # Legacy per-mailbox flag written by older AI settings UIs.
    if ai_config.get("suggestions_enabled") is False:
        return "off"

    tenant_mode = tenant_channel_ai_modes(tenant).get(channel)
    if tenant_mode in AI_MODES:
        return _govern_clamp(tenant, tenant_mode)
    return _govern_clamp(tenant, default_ai_mode(channel))
