"""First company agent and the setup conversation it starts after the tour.

The personal Bokito helper is not this agent. A daily check-in is not created
here; the SOP may turn it on only after an explicit yes.
"""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.signal import Signal
ONBOARDING_KEY = "onboarding"

SETUP_SOP = """## Workspace setup
You are onboarding this workspace in one conversation. Ask one question at a
time, confirm the answer, then write. Stop when the person says they are
done, or when the steps below are finished. Do not create a second agent.
Do not create a check-in unless they clearly say yes.

1. Introduce yourself with your name and ask if that name is right.
2. Organization: what the company does, who it serves, and the tone of voice.
   Write that into company.md and persona.md with write_doc.
3. Processes: where customers write, and what a conversation should become
   (a reply, a ticket, a quote, bookkeeping). Recommend only the matching
   module with recommend_module or suggest_integration.
4. Prepare the workspace as proposals, not silent changes: connect a channel,
   an action tag or flow when the process needs one, and invite teammates
   when there are colleagues. A description and system prompt change goes
   through update_agent so it lands in Govern for approval. Other structural
   changes use propose_action. Tell them the proposal is waiting. Do not
   apply it yourself.
5. Last, and optional: explain a daily check-in. Call set_platform_watch with
   enabled true only after an explicit yes. Without that yes, do not create a
   wake or an Agenda conversation.
6. When the steps are done or the person stops, say what is in place and what
   is still a proposal. Do not keep interviewing.
"""

_LANGUAGE_NAMES = {
    "nl": "Dutch",
    "en": "English",
    "de": "German",
    "fr": "French",
    "es": "Spanish",
}


def starter_system_prompt(
    *,
    name: str,
    company: str,
    language: str,
    intake: dict[str, str] | None = None,
) -> str:
    """Short identity plus the setup SOP. Intake is context, not the brief."""
    lang = _LANGUAGE_NAMES.get((language or "nl").strip().lower(), "Dutch")
    bits = [f"{key}={value}" for key, value in (intake or {}).items() if value]
    intake_block = ""
    if bits:
        intake_block = "First-run intake (do not ask these again):\n" + "\n".join(
            f"- {bit}" for bit in bits
        )
    return (
        f"You are {name}, the lead assistant of {company}.\n"
        f"Speak and write in {lang}.\n"
        "The setup conversation still has to write your real brief. Until then, "
        "help the person set the workspace up. Do not pretend you already know "
        "their customers or processes.\n"
        f"{intake_block}\n\n{SETUP_SOP}"
    ).strip()


def fallback_opener(name: str, language: str) -> str:
    if (language or "").strip().lower() == "en":
        return f"Hi, I'm {name}, your assistant. Is this the name you want to use?"
    return f"Hoi, ik ben {name}, je assistent. Is dit de naam die je wilt gebruiken?"


def _onboarding_block(settings: dict) -> dict:
    raw = settings.get(ONBOARDING_KEY)
    return dict(raw) if isinstance(raw, dict) else {}


def _setup_signal_id(block: dict) -> UUID | None:
    raw = str(block.get("setup_signal_id") or "").strip()
    if not raw:
        return None
    try:
        return UUID(raw)
    except ValueError:
        return None


async def open_lead_setup_thread(
    session: AsyncSession,
    tenant: Tenant,
    *,
    user_id: UUID,
) -> dict[str, str]:
    """Open the lead's setup conversation and let them speak first.

    Idempotent: a second call returns the same thread and does not kick again.
    """
    from app.services.chat_runtime import post_message, start_agent_turn
    from app.services.lead_agent import get_lead_agent
    from app.services.ownership import set_owner
    from app.services.workspaces_portal import parse_settings, save_settings

    settings = parse_settings(tenant)
    block = _onboarding_block(settings)
    existing_id = _setup_signal_id(block)
    if existing_id:
        existing = await session.get(Signal, existing_id)
        if (
            existing is not None
            and existing.tenant_id == tenant.id
            and existing.deleted_at is None
        ):
            return {"signal_id": str(existing.id), "created": "false"}

    lead = await get_lead_agent(session, tenant.id)
    if lead is None or lead.acts_for_user:
        raise HTTPException(status_code=404, detail="Create your first agent before the tour")

    now = datetime.utcnow()
    signal = Signal(
        tenant_id=tenant.id,
        channel="internal",
        source="onboarding",
        subject=(lead.name or "Assistant")[:200],
        contact_name=(lead.name or "Assistant")[:200],
        agent_id=lead.id,
        status="open",
        priority="normal",
        has_unread=True,
        last_message_at=now,
    )
    set_owner(signal, "user", user_id, by_user_id=user_id)
    session.add(signal)
    await session.flush()

    block["setup_signal_id"] = str(signal.id)
    settings[ONBOARDING_KEY] = block
    save_settings(tenant, settings)
    session.add(tenant)
    await session.commit()
    await session.refresh(signal)
    await session.refresh(lead)

    language = str(settings.get("ai_workspace_language") or "nl")
    text = ""
    try:
        result = await start_agent_turn(
            session,
            tenant_id=tenant.id,
            user_id=user_id,
            agent=lead,
            signal=signal,
            user_text=(
                "Begin the workspace setup now. Introduce yourself by name and "
                "ask only whether that name is right. One question. Do not call tools yet."
            ),
            trust="system",
            surface="onboarding_setup",
            extra_system=lead.system_prompt or SETUP_SOP,
        )
        text = str(result.get("text") or "").strip()
    except Exception:
        text = ""
    if not text:
        text = fallback_opener(lead.name, language)
    await post_message(
        session,
        signal,
        content=text,
        role="assistant",
        trust="system",
        author_agent_id=lead.id,
    )
    signal.has_unread = True
    signal.last_message_at = datetime.utcnow()
    session.add(signal)
    await session.commit()
    return {"signal_id": str(signal.id), "created": "true"}
