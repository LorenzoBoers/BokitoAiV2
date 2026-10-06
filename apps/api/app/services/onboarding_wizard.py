"""First-run onboarding wizard state (intake + completion flag).

Persisted on the tenant under settings_json.onboarding. New workspaces set
wizard_required=True in default_tenant_settings; legacy tenants without that
flag never get force-redirected into the wizard.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import select
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
    return (
        await session.execute(
            select(Agent)
            .where(
                Agent.tenant_id == tenant_id,
                Agent.kind == "company",
                Agent.is_active == True,  # noqa: E712
                Agent.is_lead == True,  # noqa: E712
            )
            .order_by(Agent.created_at)
            .limit(1)
        )
    ).scalars().first()


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
            }
            if agent
            else None
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

    if complete:
        if role not in ("owner", "admin"):
            from fastapi import HTTPException

            raise HTTPException(status_code=403, detail="Only owners can complete the wizard")
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
