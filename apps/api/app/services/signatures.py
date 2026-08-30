"""Sender identity + signature resolution for outbound replies.

One coherent model:
- A reply is sent "as" an identity: a user (human approved / manual reply) or
  an agent (auto mode, or explicitly chosen at approval time).
- Exactly one signature is appended server-side, resolved by identity:
  user signature -> agent signature -> dynamic default from identity +
  workspace language -> mailbox ``signature_html`` fallback
  (the mailbox fallback lives in ``app.channels.email._append_signature``).
- The visible From *display name* follows the same identity; the From
  *address* stays the connected mailbox (OAuth deliverability).
- Agent signatures are plain text (converted to HTML at send time). Legacy
  ``email_signature_html`` still resolves.
- Every agent-identity send appends a small Bokito AI powered-by line with a
  link to https://bokito.ai (disclaimer + light branding).
- The model never writes its own sign-off (stripped by
  ``services/suggestion_format.py``), so signatures can never stack.
- Defaults are composed at send/preview time — not persisted — so they stay
  in sync with name, role, company, and language.
"""

from __future__ import annotations

import html
import json
import re
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.auth import Tenant, User
from app.services.language import normalize_platform_language, resolve_workspace_language

SEND_AS_CHOICES = ("user", "agent")
DEFAULT_SEND_AS = "user"
# Per-agent default when unset: mail as the agent (not impersonate a human).
DEFAULT_AGENT_SEND_AS = "agent"

# Signatures are small fragments, not documents.
MAX_SIGNATURE_LENGTH = 5000

SIGNATURE_KEY = "email_signature_html"
SIGNATURE_TEXT_KEY = "email_signature_text"
REPLY_SEND_AS_KEY = "reply_send_as"

_CLOSINGS = {
    "nl": "Met vriendelijke groet",
    "en": "Kind regards",
    "de": "Mit freundlichen Grüßen",
    "fr": "Cordialement",
    "es": "Un saludo",
}

_BOKITO_SITE = "https://bokito.ai"


def _settings(raw: str | None) -> dict:
    try:
        data = json.loads(raw or "{}")
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def user_signature_html(user: User) -> str:
    return str(_settings(user.settings_json).get(SIGNATURE_KEY) or "").strip()


def plain_text_to_signature_html(text: str) -> str:
    """Escape plain signature text and preserve line breaks."""
    cleaned = (text or "").strip()
    if not cleaned:
        return ""
    escaped = html.escape(cleaned)
    body = "<br>".join(line if line else "<br>" for line in escaped.splitlines())
    # Collapse accidental double blank markers from empty lines.
    body = re.sub(r"(?:<br>){3,}", "<br><br>", body)
    return f"<p>{body}</p>"


def html_signature_to_plain_text(value: str) -> str:
    """Best-effort plain text from a legacy HTML signature for the editor."""
    raw = (value or "").strip()
    if not raw:
        return ""
    text = re.sub(r"(?i)<br\s*/?>", "\n", raw)
    text = re.sub(r"(?i)</p\s*>", "\n", text)
    text = re.sub(r"(?i)<[^>]+>", "", text)
    text = (
        text.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
    )
    lines = [line.rstrip() for line in text.splitlines()]
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    return "\n".join(lines).strip()


def agent_signature_text(agent: Agent) -> str:
    """Plain-text signature for an agent (preferred over legacy HTML)."""
    stored = _settings(agent.settings_json)
    text = str(stored.get(SIGNATURE_TEXT_KEY) or "").strip()
    if text:
        return text
    legacy = str(stored.get(SIGNATURE_KEY) or "").strip()
    if legacy:
        return html_signature_to_plain_text(legacy)
    return ""


def agent_signature_html(agent: Agent) -> str:
    """HTML body for the agent signature without the Bokito powered-by line."""
    text = agent_signature_text(agent)
    if text:
        return plain_text_to_signature_html(text)
    legacy = str(_settings(agent.settings_json).get(SIGNATURE_KEY) or "").strip()
    return legacy


def agent_reply_send_as(agent: Agent | None) -> str:
    """Per-agent default for Send as on approvals. Falls back to agent identity."""
    if agent is None:
        return DEFAULT_AGENT_SEND_AS
    value = str(_settings(agent.settings_json).get(REPLY_SEND_AS_KEY) or "").strip()
    return value if value in SEND_AS_CHOICES else DEFAULT_AGENT_SEND_AS


def tenant_reply_send_as(tenant: Tenant) -> str:
    """Tenant default for the send-as choice on approved suggestions."""
    value = str(_settings(tenant.settings_json).get("reply_send_as") or "").strip()
    return value if value in SEND_AS_CHOICES else DEFAULT_SEND_AS


def bokito_agent_disclaimer_html(language: str | None = None) -> str:
    """Subtle AI-agent disclaimer + Bokito branding under agent signatures."""
    lang = normalize_platform_language(language)
    if language and language in _CLOSINGS:
        lang = language
    if lang == "nl":
        lead = "Beantwoord door een AI-agent"
    else:
        lead = "Replied by an AI agent"
    return (
        f'<p style="margin:14px 0 0;padding-top:10px;border-top:1px solid #e8eaed;'
        f'font-size:11px;line-height:1.45;color:#9aa0a6">'
        f"{html.escape(lead)}"
        f' · Powered by '
        f'<a href="{_BOKITO_SITE}" style="color:#6b7280;text-decoration:underline" '
        f'target="_blank" rel="noopener noreferrer">Bokito AI</a></p>'
    )


def with_agent_disclaimer(signature_html: str, *, language: str | None = None) -> str:
    body = (signature_html or "").strip()
    disclaimer = bokito_agent_disclaimer_html(language)
    return f"{body}{disclaimer}" if body else disclaimer


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


async def resolve_from_display_name(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    send_as: str,
    user_id: UUID | None = None,
    agent_id: UUID | None = None,
) -> str | None:
    """Visible From display name for the chosen send-as identity.

    The mailbox *address* always stays the connected ChannelAccount address
    (OAuth deliverability). Only the display name follows user vs agent so
    customers see who is speaking in the From line, matching the signature.
    """
    if send_as == "user" and user_id:
        user = (
            await session.execute(select(User).where(User.id == user_id))
        ).scalar_one_or_none()
        if user:
            return (user.display_name or user.email or "").strip() or None
        return None

    if agent_id:
        agent = (
            await session.execute(
                select(Agent).where(Agent.id == agent_id, Agent.tenant_id == tenant_id)
            )
        ).scalar_one_or_none()
        if agent:
            return (agent.name or "Assistant").strip() or None
    return None


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

    Agent-identity sends always include the Bokito powered-by disclaimer.
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
            if send_as == "agent":
                return with_agent_disclaimer(signature, language=language)
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
        from app.services.agent_avatar import signature_avatar_html

        default = compose_default_signature_html(
            name=agent.name or "Assistant",
            company=company,
            language=language,
        )
        body = f"{signature_avatar_html(agent)}{default}"
        if send_as == "agent":
            return with_agent_disclaimer(body, language=language)
        return body

    return None
