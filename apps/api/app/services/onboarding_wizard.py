"""First-run onboarding wizard state (intake + completion flag).

Persisted on the tenant under settings_json.onboarding. New workspaces set
wizard_required=True in default_tenant_settings; legacy tenants without that
flag never get force-redirected into the wizard.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent import Agent
from app.models.auth import Tenant
from app.services.workspaces_portal import parse_settings, save_settings

ONBOARDING_KEY = "onboarding"

INTAKE_SOURCES = frozenset(
    {"search", "referral", "social", "partner", "other", ""}
)
ORG_SIZES = frozenset({"1", "2-10", "11-50", "51-200", "200+", ""})
USE_CASES = frozenset(
    {"inbox", "support", "sales", "ops", "agency", "other", ""}
)


def _onboarding_block(settings: dict[str, Any]) -> dict[str, Any]:
    raw = settings.get(ONBOARDING_KEY)
    return dict(raw) if isinstance(raw, dict) else {}


def wizard_required(settings: dict[str, Any]) -> bool:
    block = _onboarding_block(settings)
    if block.get("wizard_completed_at"):
        return False
    return bool(block.get("wizard_required"))


def serialize_intake(block: dict[str, Any]) -> dict[str, str]:
    intake = block.get("intake") if isinstance(block.get("intake"), dict) else {}
    return {
        "source": str(intake.get("source") or ""),
        "org_size": str(intake.get("org_size") or ""),
        "use_case": str(intake.get("use_case") or ""),
    }


async def lead_assistant_row(session: AsyncSession, tenant_id: UUID) -> Agent | None:
    """The company lead. The personal Bokito helper is not this agent."""
    from app.services.lead_agent import get_lead_agent

    lead = await get_lead_agent(session, tenant_id)
    if lead is None or lead.acts_for_user:
        return None
    return lead


async def get_wizard_state(
    session: AsyncSession, tenant: Tenant, *, role: str, user_settings_json: str | None = None
) -> dict[str, Any]:
    from app.services.agent_avatar import avatar_payload

    settings = parse_settings(tenant)
    block = _onboarding_block(settings)
    agent = await lead_assistant_row(session, tenant.id)
    needed = wizard_required(settings) and role in ("owner", "admin")
    personal_done = False
    tour_seen = False
    if user_settings_json:
        import json

        try:
            user_stored = json.loads(user_settings_json or "{}")
        except (TypeError, json.JSONDecodeError):
            user_stored = {}
        if isinstance(user_stored, dict):
            personal_done = bool(user_stored.get("personal_wizard_completed"))
            tour = user_stored.get("tour")
            if isinstance(tour, dict):
                tour_seen = bool(
                    tour.get("intro_done") or tour.get("completed") or tour.get("dismissed")
                )
    # Invited members only: language + notifications once, before the tour.
    # Members who already saw/dismissed the tour are never force-redirected.
    needs_personal = (
        role not in ("owner", "admin") and not personal_done and not tour_seen
    )
    avatar = avatar_payload(agent)
    return {
        "wizard_required": bool(block.get("wizard_required")),
        "wizard_completed_at": block.get("wizard_completed_at"),
        "needs_wizard": needed,
        "needs_personal_wizard": needs_personal,
        "personal_wizard_completed": personal_done,
        "intake": serialize_intake(block),
        "ai_workspace_language": settings.get("ai_workspace_language") or "nl",
        "autonomy_posture": settings.get("autonomy_posture") or "assisted",
        "lead_agent": (
            {
                "id": str(agent.id),
                "name": agent.name,
                "avatar_kind": avatar.get("avatar_kind"),
                "avatar_icon": avatar.get("avatar_icon"),
                "avatar_color": avatar.get("avatar_color"),
                "avatar_shape": avatar.get("avatar_shape"),
                "job_title": agent.job_title or "",
                "description": agent.description or "",
            }
            if agent
            else None
        ),
        "suggested_agent_name": (
            f"{(tenant.name or '').strip()} assistant".strip()[:120] or "assistant"
        ),
        "scope": "owner" if role in ("owner", "admin") else "member",
    }


async def patch_wizard_state(
    session: AsyncSession,
    tenant: Tenant,
    *,
    role: str,
    intake: dict[str, Any] | None = None,
    ai_workspace_language: str | None = None,
    autonomy_posture: str | None = None,
    lead_agent: dict[str, Any] | None = None,
    complete: bool | None = None,
    user_settings_json: str | None = None,
) -> dict[str, Any]:
    settings = parse_settings(tenant)
    block = _onboarding_block(settings)

    if intake is not None:
        if role not in ("owner", "admin"):
            from fastapi import HTTPException

            raise HTTPException(status_code=403, detail="Only owners can set intake")
        current = serialize_intake(block)
        source = str(intake.get("source", current["source"])).strip()
        org_size = str(intake.get("org_size", current["org_size"])).strip()
        use_case = str(intake.get("use_case", current["use_case"])).strip()
        if source not in INTAKE_SOURCES:
            source = current["source"]
        if org_size not in ORG_SIZES:
            org_size = current["org_size"]
        if use_case not in USE_CASES:
            use_case = current["use_case"]
        block["intake"] = {
            "source": source,
            "org_size": org_size,
            "use_case": use_case,
        }

    if ai_workspace_language is not None:
        if role not in ("owner", "admin"):
            from fastapi import HTTPException

            raise HTTPException(status_code=403, detail="Only owners can set workspace language")
        from app.services.language import WORKSPACE_LANGUAGE_CHOICES

        if ai_workspace_language not in WORKSPACE_LANGUAGE_CHOICES:
            from fastapi import HTTPException

            raise HTTPException(status_code=400, detail="Invalid ai_workspace_language")
        settings["ai_workspace_language"] = ai_workspace_language

    if autonomy_posture is not None:
        if role not in ("owner", "admin"):
            from fastapi import HTTPException

            raise HTTPException(status_code=403, detail="Only owners can set posture")
        from app.tools.policy import AUTONOMY_POSTURES

        if autonomy_posture not in AUTONOMY_POSTURES:
            from fastapi import HTTPException

            raise HTTPException(status_code=400, detail="Invalid autonomy_posture")
        settings["autonomy_posture"] = autonomy_posture

    if lead_agent is not None:
        if role not in ("owner", "admin"):
            from fastapi import HTTPException

            raise HTTPException(status_code=403, detail="Only owners can create the first agent")
        await _upsert_first_agent(session, tenant, settings, block, lead_agent)

    if complete:
        if role not in ("owner", "admin"):
            from fastapi import HTTPException

            raise HTTPException(status_code=403, detail="Only owners can complete the wizard")
        if await lead_assistant_row(session, tenant.id) is None:
            from fastapi import HTTPException

            raise HTTPException(status_code=400, detail="Create your first agent before finishing")
        block["wizard_completed_at"] = datetime.now(timezone.utc).isoformat()
        block["wizard_required"] = False
        await _append_intake_to_lead_prompt(session, tenant.id, serialize_intake(block))

    settings[ONBOARDING_KEY] = block
    save_settings(tenant, settings)
    session.add(tenant)
    await session.commit()
    await session.refresh(tenant)
    return await get_wizard_state(
        session, tenant, role=role, user_settings_json=user_settings_json
    )


async def _upsert_first_agent(
    session: AsyncSession,
    tenant: Tenant,
    settings: dict[str, Any],
    block: dict[str, Any],
    payload: dict[str, Any],
) -> None:
    """Create the company lead, or rename the one this wizard already made."""
    from fastapi import HTTPException

    from app.services.lead_agent import set_lead_agent
    from app.services.onboarding_setup import starter_system_prompt
    from app.services.workforce_runtime import create_agent, update_agent
    from app.tools.policy import AUTONOMY_POSTURES

    name = str(payload.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Agent name is required")
    avatar_kind = str(payload.get("avatar_kind") or "orb").strip().lower()
    if avatar_kind not in ("orb", "initials", "icon"):
        avatar_kind = "orb"
    avatar_color = str(payload.get("avatar_color") or "").strip() or None
    avatar_shape = str(payload.get("avatar_shape") or "").strip() or None
    avatar_icon = str(payload.get("avatar_icon") or "").strip() or None
    language = str(settings.get("ai_workspace_language") or "nl")
    posture = str(settings.get("autonomy_posture") or "assisted")
    if posture not in AUTONOMY_POSTURES:
        posture = "assisted"
    prompt = starter_system_prompt(
        name=name,
        company=(tenant.name or "").strip() or name,
        language=language,
        intake=serialize_intake(block),
    )
    job_title = str(payload.get("job_title") or "Onboarding specialist").strip()[:32]
    if not job_title:
        raise HTTPException(status_code=400, detail="Agent job title is required")
    description = str(payload.get("description") or "").strip()[:280]
    existing = await lead_assistant_row(session, tenant.id)
    if existing is None:
        created = await create_agent(
            session,
            tenant.id,
            name=name,
            role="assistant",
            job_title=job_title,
            description=description,
            system_prompt=prompt,
            chat_access="everyone",
        )
        agent_id = UUID(str(created["agent"]["id"]))
        await set_lead_agent(session, tenant.id, agent_id, commit=False)
    else:
        agent_id = existing.id
    await update_agent(
        session,
        tenant.id,
        agent_id,
        name=name,
        job_title=job_title,
        description=description,
        system_prompt=prompt,
        avatar_kind=avatar_kind,
        avatar_icon="" if avatar_kind != "icon" else (avatar_icon or "bot"),
        avatar_color=avatar_color or "" if avatar_kind == "orb" else "",
        avatar_shape=avatar_shape or "" if avatar_kind == "orb" else "",
        avatar_image_url="",
    )
    agent = await session.get(Agent, agent_id)
    if agent is not None:
        agent.autonomy_level = posture
        agent.is_lead = True
        session.add(agent)
    await session.refresh(tenant)


async def _append_intake_to_lead_prompt(
    session: AsyncSession, tenant_id: UUID, intake: dict[str, str]
) -> None:
    """Give the lead assistant the intake facts so setup chat does not re-ask."""
    agent = await lead_assistant_row(session, tenant_id)
    if not agent:
        return
    bits = [f"{k}={v}" for k, v in intake.items() if v]
    if not bits:
        return
    marker = "## First-run intake"
    line = f"{marker}\n" + "\n".join(f"- {b}" for b in bits)
    prompt = (agent.system_prompt or "").strip()
    if marker in prompt:
        # Replace existing block (through next blank line or end).
        head, _, rest = prompt.partition(marker)
        # Drop old block until a blank line after the marker section.
        leftover = rest.lstrip("\n")
        parts = leftover.split("\n\n", 1)
        prompt = (head.rstrip() + "\n\n" + line + ("\n\n" + parts[1] if len(parts) > 1 else "")).strip()
    else:
        prompt = f"{prompt}\n\n{line}".strip() if prompt else line
    agent.system_prompt = prompt
    session.add(agent)
