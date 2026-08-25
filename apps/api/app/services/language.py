"""Language policy for AI-generated communication.

Two independent language axes:

- **Reply language** — the language of drafted reply bodies (suggest mode
  cards and auto-mode outbound replies). Default ``auto``: mirror the
  language of the customer's most recent message, so an English email gets
  an English draft even on a Dutch workspace. Can be pinned to a fixed
  language per mailbox (``ai_config.reply_language``) or tenant-wide
  (``settings.ai_reply_language``).

- **Workspace language** — the language of text the AI writes *for the
  team*: no-reply summaries, explanations, decision context. Tenant-wide
  (``settings.ai_workspace_language``), falling back to
  ``PLATFORM_DEFAULT_LANGUAGE`` (Dutch unless overridden).

Static UI copy on suggestion cards (titles, button labels) is not handled
here; the dashboard translates those client-side via i18n.
"""

import json
from typing import Any

from app.models.auth import Tenant
from app.models.channel import ChannelAccount
from app.services.channel_ai import account_ai_config

AUTO = "auto"

# Languages offered in settings; prompt instructions use the English name.
LANGUAGE_NAMES: dict[str, str] = {
    "nl": "Dutch",
    "en": "English",
    "de": "German",
    "fr": "French",
    "es": "Spanish",
}

REPLY_LANGUAGE_CHOICES = (AUTO, *LANGUAGE_NAMES.keys())
WORKSPACE_LANGUAGE_CHOICES = tuple(LANGUAGE_NAMES.keys())

def normalize_platform_language(value: str | None) -> str:
    """UI languages are ``en`` or ``nl``. Empty or unknown values become ``nl``."""
    raw = (value or "").strip().lower()
    return raw if raw in ("en", "nl") else "nl"


def platform_default_ui_language() -> str:
    from app.config import get_settings

    return normalize_platform_language(get_settings().platform_default_language)


def _tenant_settings(tenant: Tenant | None) -> dict[str, Any]:
    if tenant is None:
        return {}
    try:
        data = json.loads(tenant.settings_json or "{}")
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def resolve_reply_language(tenant: Tenant | None, account: ChannelAccount | None) -> str:
    """Mailbox ai_config.reply_language -> tenant ai_reply_language -> auto."""
    account_value = account_ai_config(account).get("reply_language")
    if account_value in REPLY_LANGUAGE_CHOICES:
        return account_value
    tenant_value = _tenant_settings(tenant).get("ai_reply_language")
    if tenant_value in REPLY_LANGUAGE_CHOICES:
        return tenant_value
    return AUTO


def resolve_workspace_language(tenant: Tenant | None) -> str:
    value = _tenant_settings(tenant).get("ai_workspace_language")
    if value in WORKSPACE_LANGUAGE_CHOICES:
        return value
    return platform_default_ui_language()


def reply_language_instruction(code: str) -> str:
    """Prompt line describing what language the reply body must be in."""
    if code == AUTO:
        return (
            "Write the reply body in the same language as the customer's message "
            "(mirror their language exactly; do not translate to another language)."
        )
    name = LANGUAGE_NAMES.get(code, "English")
    return f"Write the reply body in {name}, regardless of the customer's language."


def workspace_language_instruction(code: str) -> str:
    """Prompt line for team-facing text (summaries, explanations)."""
    name = LANGUAGE_NAMES.get(code, "English")
    return (
        f"Any summary or explanation addressed to the internal team "
        f"(including the text after NO_REPLY_NEEDED:) must be written in {name}."
    )
