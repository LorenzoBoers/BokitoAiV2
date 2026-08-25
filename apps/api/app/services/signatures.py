"""Sender identity + signature resolution for outbound replies.

One coherent model:
- A reply is sent "as" an identity: a user (human approved / manual reply) or
  an agent (auto mode, or explicitly chosen at approval time).
- Exactly one signature is appended server-side, resolved by identity:
  user signature -> agent signature -> mailbox ``signature_html`` fallback
  (the fallback lives in ``app.channels.email._append_signature``).
- The model never writes its own sign-off (stripped by
  ``services/suggestion_format.py``), so signatures can never stack.
"""

from __future__ import annotations

import json
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.auth import Tenant, User

SEND_AS_CHOICES = ("user", "agent")
DEFAULT_SEND_AS = "user"

# Signatures are small HTML fragments, not documents.
MAX_SIGNATURE_LENGTH = 5000

SIGNATURE_KEY = "email_signature_html"


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


async def resolve_signature_html(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    send_as: str,
    user_id: UUID | None = None,
    agent_id: UUID | None = None,
) -> str | None:
    """Resolve the one signature for this send. ``None`` means: let the email
    adapter fall back to the mailbox ``signature_html``.

    Identity-first chain: sending as a user prefers that user's signature;
    the agent signature is the next step down; the mailbox signature is the
    final fallback (handled by the adapter).
    """
    if send_as == "user" and user_id:
        user = (
            await session.execute(select(User).where(User.id == user_id))
        ).scalar_one_or_none()
        if user:
            signature = user_signature_html(user)
            if signature:
                return signature
    if agent_id:
        agent = (
            await session.execute(
                select(Agent).where(Agent.id == agent_id, Agent.tenant_id == tenant_id)
            )
        ).scalar_one_or_none()
        if agent:
            signature = agent_signature_html(agent)
            if signature:
                return signature
    return None
