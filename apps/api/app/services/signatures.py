"""Sender identity + signature resolution for outbound replies.

One coherent model:
- A reply is sent "as" an identity: a user (human approved / manual reply) or
  an agent (auto mode, or explicitly chosen at approval time).
- Exactly one signature is appended server-side, resolved by identity:
  user signature -> agent signature -> dynamic default from identity +
  workspace language -> mailbox ``signature_html`` fallback
  (the mailbox fallback lives in ``app.channels.email._append_signature``).
- The model never writes its own sign-off (stripped by
  ``services/suggestion_format.py``), so signatures can never stack.
- Defaults are composed at send/preview time — not persisted — so they stay
  in sync with name, role, company, and language.
"""

from __future__ import annotations

import html
import json
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.auth import Tenant, User
from app.services.language import normalize_platform_language, resolve_workspace_language

SEND_AS_CHOICES = ("user", "agent")
DEFAULT_SEND_AS = "user"

# Signatures are small HTML fragments, not documents.
MAX_SIGNATURE_LENGTH = 5000

SIGNATURE_KEY = "email_signature_html"

_CLOSINGS = {
    "nl": "Met vriendelijke groet",
    "en": "Kind regards",
    "de": "Mit freundlichen Grüßen",
    "fr": "Cordialement",
    "es": "Un saludo",
}


def _settings(raw: str | None) -> dict:
    try:
        data = json.loads(raw or "{}")
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def user_signature_html(user: User) -> str:
    return str(_settings(user.settings_json).get(SIGNATURE_KEY) or "").strip()


def agent_signature_html(agent: Agent) -> str:
    return str(_settings(agent.settings_json).get(SIGNATURE_KEY) or "").strip()


def tenant_reply_send_as(tenant: Tenant) -> str:
    """Tenant default for the send-as choice on approved suggestions."""
    value = str(_settings(tenant.settings_json).get("reply_send_as") or "").strip()
    return value if value in SEND_AS_CHOICES else DEFAULT_SEND_AS


def compose_default_signature_html(
    *,
    name: str,
    email: str | None = None,
    job_title: str | None = None,
    company: str | None = None,
    language: str | None = None,
) -> str:
    """Build a textual signature from identity fields and workspace language.

    Not persisted — callers treat this as the effective signature when the
    user/agent has not configured a custom one.
    """
    display = (name or "").strip() or (email or "").strip() or "Team"
    lang = normalize_platform_language(language)
    if language and language in _CLOSINGS:
        lang = language
    closing = _CLOSINGS.get(lang, _CLOSINGS["en"])
    parts = [
        f"<p>{html.escape(closing)},<br><br>",
        f"<strong>{html.escape(display)}</strong>",
    ]
    title = (job_title or "").strip()
    if title:
        parts.append(f"<br>{html.escape(title)}")
    org = (company or "").strip()
    if org:
        parts.append(f"<br>{html.escape(org)}")
    addr = (email or "").strip()
    if addr and addr.lower() != display.lower():
        parts.append(f"<br>{html.escape(addr)}")
    parts.append("</p>")
    return "".join(parts)


def tenant_company_name(tenant: Tenant | None) -> str:
    if tenant is None:
        return ""
    return str(tenant.name or "").strip()


async def resolve_signature_html(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    send_as: str,
    user_id: UUID | None = None,
    agent_id: UUID | None = None,
) -> str | None:
    """Resolve the one signature for this send.

    Chain: identity custom HTML → other-identity custom → dynamic default
    from the active identity → ``None`` so the email adapter can use the
    mailbox ``signature_html``.
    """
    tenant = (
        await session.execute(select(Tenant).where(Tenant.id == tenant_id))
    ).scalar_one_or_none()
    language = resolve_workspace_language(tenant)
    company = tenant_company_name(tenant)

    user: User | None = None
    if user_id:
        user = (
            await session.execute(select(User).where(User.id == user_id))
        ).scalar_one_or_none()

    agent: Agent | None = None
    if agent_id:
        agent = (
            await session.execute(
                select(Agent).where(Agent.id == agent_id, Agent.tenant_id == tenant_id)
            )
        ).scalar_one_or_none()

    if send_as == "user" and user:
        signature = user_signature_html(user)
        if signature:
            return signature

    if agent:
        signature = agent_signature_html(agent)
        if signature:
            return signature

    if send_as == "user" and user:
        return compose_default_signature_html(
            name=user.display_name or user.email,
            email=user.email,
            job_title=user.job_title,
            company=company,
            language=language,
        )

    if agent:
        return compose_default_signature_html(
            name=agent.name or "Assistant",
            company=company,
            language=language,
        )

    return None
