"""Learning loop v2: default-on, guardrail proposals, persona review, digest stats."""

import json

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.auth import Tenant, User
from app.models.learning import EvalScore, Feedback
from app.models.platform_change import PlatformChange
from app.services.learning import (
    apply_heuristic_guardrails,
    propose_persona_review,
    run_tenant_learning_cycle,
)


async def _tenant(session) -> Tenant:
    return (await session.execute(select(Tenant).where(Tenant.slug == "test"))).scalar_one()


def _set_settings(tenant: Tenant, **overrides) -> None:
    settings = json.loads(tenant.settings_json or "{}")
    settings.update(overrides)
    tenant.settings_json = json.dumps(settings)


def _escalation_score(tenant_id, value: float) -> EvalScore:
    return EvalScore(
        tenant_id=tenant_id,
        scope="tenant",
        scope_id=str(tenant_id),
        metric="escalation_rate",
        value=value,
        sample_size=10,
    )


# ── default-on ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_learning_cycle_runs_by_default(client: AsyncClient, session_override):
    tenant = await _tenant(session_override)
    settings = json.loads(tenant.settings_json or "{}")
    assert "learning_enabled" not in settings

    result = await run_tenant_learning_cycle(session_override, tenant.id)
    assert not result.get("skipped")
    assert "eval_count" in result


@pytest.mark.asyncio
async def test_learning_cycle_respects_explicit_opt_out(client: AsyncClient, session_override):
    tenant = await _tenant(session_override)
    _set_settings(tenant, learning_enabled=False)
    session_override.add(tenant)
    await session_override.commit()

    result = await run_tenant_learning_cycle(session_override, tenant.id)
    assert result == {"skipped": True, "reason": "learning_disabled"}


# ── guardrails: tighten automatic, ease via proposal ─────────────


@pytest.mark.asyncio
async def test_guardrails_tighten_applies_and_audits(client: AsyncClient, session_override):
    tenant = await _tenant(session_override)
    _set_settings(tenant, autonomy_posture="autonomous")
    session_override.add(tenant)
    session_override.add(_escalation_score(tenant.id, 55.0))
    await session_override.commit()

    result = await apply_heuristic_guardrails(session_override, tenant.id)
    assert result["posture"] == "assisted"

    await session_override.refresh(tenant)
    assert json.loads(tenant.settings_json)["autonomy_posture"] == "assisted"

    from app.models.audit import AuditEvent

    audits = (
        await session_override.execute(
            select(AuditEvent).where(AuditEvent.action == "learning:posture_tightened")
        )
    ).scalars().all()
    assert len(audits) == 1
    assert audits[0].actor_type == "system"


@pytest.mark.asyncio
async def test_guardrails_ease_creates_proposal_not_silent_change(
    client: AsyncClient, session_override
):
    tenant = await _tenant(session_override)
    _set_settings(tenant, autonomy_posture="manual")
    session_override.add(tenant)
    session_override.add(_escalation_score(tenant.id, 2.0))
    await session_override.commit()

    result = await apply_heuristic_guardrails(session_override, tenant.id)
    assert result.get("posture_proposal") == "assisted"
    # Posture itself is untouched.
    await session_override.refresh(tenant)
    assert json.loads(tenant.settings_json)["autonomy_posture"] == "manual"

    proposals = (
        await session_override.execute(
            select(PlatformChange).where(PlatformChange.resource_type == "autonomy_posture")
        )
    ).scalars().all()
    assert len(proposals) == 1
    assert proposals[0].status == "pending_review"
    assert proposals[0].proposed_by_type == "system"

    # Second run does not duplicate the open proposal.
    session_override.add(_escalation_score(tenant.id, 3.0))
    await session_override.commit()
    await apply_heuristic_guardrails(session_override, tenant.id)
    proposals = (
        await session_override.execute(
            select(PlatformChange).where(PlatformChange.resource_type == "autonomy_posture")
        )
    ).scalars().all()
    assert len(proposals) == 1


@pytest.mark.asyncio
async def test_accepting_posture_proposal_applies_posture(client: AsyncClient, session_override):
    from app.services.platform_changes import accept_platform_change

    tenant = await _tenant(session_override)
    _set_settings(tenant, autonomy_posture="manual")
    session_override.add(tenant)
    session_override.add(_escalation_score(tenant.id, 1.0))
    await session_override.commit()

    await apply_heuristic_guardrails(session_override, tenant.id)
    proposal = (
        await session_override.execute(
            select(PlatformChange).where(PlatformChange.resource_type == "autonomy_posture")
        )
    ).scalar_one()

    user = (await session_override.execute(select(User))).scalars().first()
    change = await accept_platform_change(session_override, tenant.id, proposal.id, user.id)
    assert change.status == "accepted"

    await session_override.refresh(tenant)
    assert json.loads(tenant.settings_json)["autonomy_posture"] == "assisted"


# ── persona review proposal ───────────────────────────────────────


@pytest.mark.asyncio
async def test_persona_review_needs_three_negatives(client: AsyncClient, session_override):
    tenant = await _tenant(session_override)
    for _ in range(2):
        session_override.add(
            Feedback(tenant_id=tenant.id, subject_type="message", sentiment="down")
        )
    await session_override.commit()

    assert await propose_persona_review(session_override, tenant.id) is False

    session_override.add(
        Feedback(
            tenant_id=tenant.id,
            subject_type="message",
            sentiment="down",
            comment="Tone was too formal",
        )
    )
    await session_override.commit()

    assert await propose_persona_review(session_override, tenant.id) is True
    proposal = (
        await session_override.execute(
            select(PlatformChange).where(PlatformChange.resource_type == "persona_review")
        )
    ).scalar_one()
    assert proposal.status == "pending_review"
    payload = json.loads(proposal.after_json)
    assert payload["negative_count"] == 3
    assert any("Tone was too formal" in s["comment"] for s in payload["samples"])

    # Dedup: no second proposal while one is open.
    assert await propose_persona_review(session_override, tenant.id) is False


@pytest.mark.asyncio
async def test_accepting_persona_review_appends_to_persona_doc(
    client: AsyncClient, session_override
):
    from app.services.platform_changes import accept_platform_change
    from app.services.workspace import get_doc_by_path

    tenant = await _tenant(session_override)
    for comment in ("Too formal", "Too long", "Missed the point"):
        session_override.add(
            Feedback(tenant_id=tenant.id, subject_type="message", sentiment="down", comment=comment)
        )
    await session_override.commit()

    assert await propose_persona_review(session_override, tenant.id) is True
    proposal = (
        await session_override.execute(
            select(PlatformChange).where(PlatformChange.resource_type == "persona_review")
        )
    ).scalar_one()

    user = (await session_override.execute(select(User))).scalars().first()
    change = await accept_platform_change(session_override, tenant.id, proposal.id, user.id)
    assert change.status == "accepted"

    doc = await get_doc_by_path(session_override, tenant.id, "persona.md")
    assert doc is not None
    assert "Feedback review" in doc.content
    assert "Too formal" in doc.content


# ── repeated thumbs-down clusters into a rule suggestion ──────────


@pytest.mark.asyncio
async def test_thumbs_down_cluster_suggests_mute_rule(client: AsyncClient, session_override):
    from app.models.learning import InboxRule
    from app.models.signal import Signal, SignalMessage
    from app.services.learning import suggest_rules_from_feedback

    tenant = await _tenant(session_override)
    sender = "angry@customer.com"
    for i in range(3):
        signal = Signal(
            tenant_id=tenant.id,
            channel="email",
            subject=f"Complaint {i}",
            contact_email=sender,
        )
        session_override.add(signal)
        await session_override.flush()
        message = SignalMessage(
            tenant_id=tenant.id,
            signal_id=signal.id,
            direction="outbound",
            body_text="AI reply",
        )
        session_override.add(message)
        await session_override.flush()
        session_override.add(
            Feedback(
                tenant_id=tenant.id,
                subject_type="message",
                subject_id=str(message.id),
                sentiment="down",
            )
        )
    await session_override.commit()

    assert await suggest_rules_from_feedback(session_override, tenant.id) == 1
    rule = (
        await session_override.execute(
            select(InboxRule).where(
                InboxRule.tenant_id == tenant.id, InboxRule.match_value == sender
            )
        )
    ).scalar_one()
    assert rule.status == "suggested"
    assert rule.action == "mute_ai"
    assert rule.observations >= 3

    # An active rule for the sender means nothing more to learn.
    rule.status = "active"
    session_override.add(rule)
    await session_override.commit()
    assert await suggest_rules_from_feedback(session_override, tenant.id) == 0


@pytest.mark.asyncio
async def test_two_thumbs_down_threads_do_not_suggest(client: AsyncClient, session_override):
    from app.models.signal import Signal, SignalMessage
    from app.services.learning import suggest_rules_from_feedback

    tenant = await _tenant(session_override)
    for i in range(2):
        signal = Signal(
            tenant_id=tenant.id,
            channel="email",
            subject=f"Msg {i}",
            contact_email="mild@customer.com",
        )
        session_override.add(signal)
        await session_override.flush()
        message = SignalMessage(
            tenant_id=tenant.id,
            signal_id=signal.id,
            direction="outbound",
            body_text="AI reply",
        )
        session_override.add(message)
        await session_override.flush()
        session_override.add(
            Feedback(
                tenant_id=tenant.id,
                subject_type="message",
                subject_id=str(message.id),
                sentiment="down",
            )
        )
    await session_override.commit()

    assert await suggest_rules_from_feedback(session_override, tenant.id) == 0


# ── category allowance tighten (allow → ask) ──────────────────────


@pytest.mark.asyncio
async def test_allowance_tighten_from_escalations(client: AsyncClient, session_override):
    from datetime import datetime

    from app.models.audit import AuditEvent
    from app.services.learning import apply_heuristic_allowance_tighten
    from app.tools.policy import tenant_allowances

    tenant = await _tenant(session_override)
    _set_settings(tenant, autonomy_posture="assisted")
    session_override.add(tenant)
    for _ in range(5):
        session_override.add(
            AuditEvent(
                tenant_id=tenant.id,
                action="tool_call:write_doc",
                actor_type="agent",
                outcome="escalated",
                summary="Escalated to human",
                created_at=datetime.utcnow(),
            )
        )
    await session_override.commit()

    result = await apply_heuristic_allowance_tighten(session_override, tenant.id)
    assert len(result["tightened"]) == 1
    assert result["tightened"][0]["category"] == "workspace"
    assert result["tightened"][0]["to"] == "ask"

    await session_override.refresh(tenant)
    settings = json.loads(tenant.settings_json)
    assert settings["tool_allowances"]["workspace"] == "ask"
    assert tenant_allowances(tenant)["workspace"] == "ask"
    assert settings["learning_allowance_history"][0]["category"] == "workspace"

    from app.models.audit import AuditEvent as AE

    audits = (
        await session_override.execute(
            select(AE).where(AE.action == "learning:allowance_tightened")
        )
    ).scalars().all()
    assert len(audits) == 1

    # Idempotent: already ask — no second tighten.
    result2 = await apply_heuristic_allowance_tighten(session_override, tenant.id)
    assert result2["tightened"] == []


@pytest.mark.asyncio
async def test_allowance_tighten_from_rejected_tool_decisions(
    client: AsyncClient, session_override
):
    from datetime import datetime

    from app.models.notification import DecisionRequest
    from app.services.learning import apply_heuristic_allowance_tighten

    tenant = await _tenant(session_override)
    _set_settings(tenant, autonomy_posture="autonomous")
    session_override.add(tenant)
    for i in range(3):
        session_override.add(
            DecisionRequest(
                tenant_id=tenant.id,
                title=f"Approve tool {i}",
                summary="gate",
                status="rejected",
                options_json=json.dumps(
                    [
                        {
                            "id": "approve",
                            "label": "Approve",
                            "action_type": "create_agent",
                            "payload": {},
                        },
                        {"id": "reject", "label": "Reject", "action_type": "reject"},
                    ]
                ),
                resolved_at=datetime.utcnow(),
            )
        )
    await session_override.commit()

    result = await apply_heuristic_allowance_tighten(session_override, tenant.id)
    assert any(row["category"] == "agents" and row["to"] == "ask" for row in result["tightened"])
    await session_override.refresh(tenant)
    assert json.loads(tenant.settings_json)["tool_allowances"]["agents"] == "ask"


@pytest.mark.asyncio
async def test_allowance_tighten_never_loosens(client: AsyncClient, session_override):
    from datetime import datetime

    from app.models.audit import AuditEvent
    from app.services.learning import apply_heuristic_allowance_tighten

    tenant = await _tenant(session_override)
    _set_settings(
        tenant,
        autonomy_posture="assisted",
        tool_allowances={"workspace": "deny"},
    )
    session_override.add(tenant)
    for _ in range(10):
        session_override.add(
            AuditEvent(
                tenant_id=tenant.id,
                action="tool_call:write_doc",
                actor_type="agent",
                outcome="escalated",
                summary="Escalated",
            )
        )
    await session_override.commit()

    result = await apply_heuristic_allowance_tighten(session_override, tenant.id)
    assert result["tightened"] == []
    await session_override.refresh(tenant)
    assert json.loads(tenant.settings_json)["tool_allowances"]["workspace"] == "deny"


@pytest.mark.asyncio
async def test_learning_cycle_includes_allowance_tighten(client: AsyncClient, session_override):
    from datetime import datetime

    from app.models.audit import AuditEvent

    tenant = await _tenant(session_override)
    _set_settings(tenant, autonomy_posture="assisted")
    session_override.add(tenant)
    for _ in range(5):
        session_override.add(
            AuditEvent(
                tenant_id=tenant.id,
                action="tool_call:write_doc",
                actor_type="agent",
                outcome="escalated",
                created_at=datetime.utcnow(),
            )
        )
    await session_override.commit()

    result = await run_tenant_learning_cycle(session_override, tenant.id)
    assert not result.get("skipped")
    assert len(result.get("allowances", {}).get("tightened") or []) == 1


@pytest.mark.asyncio
async def test_digest_includes_allowance_tighten_count(client: AsyncClient, session_override):
    from datetime import datetime

    from app.models.audit import AuditEvent
    from app.services.digest_mail import build_tenant_digest, digest_paragraphs

    tenant = await _tenant(session_override)
    session_override.add(
        AuditEvent(
            tenant_id=tenant.id,
            action="learning:allowance_tightened",
            actor_type="system",
            summary="workspace allow → ask",
            created_at=datetime.utcnow(),
        )
    )
    await session_override.commit()

    digest = await build_tenant_digest(session_override, tenant.id, period="weekly")
    assert digest["allowances_tightened"] == 1
    lines = digest_paragraphs(digest, tenant.name)
    learning_line = next(line for line in lines if line.startswith("Learning:"))
    assert "policy slider(s) tightened" in learning_line



@pytest.mark.asyncio
async def test_digest_includes_learning_stats(client: AsyncClient, session_override):
    from app.models.learning import InboxRule
    from app.services.digest_mail import build_tenant_digest, digest_paragraphs

    tenant = await _tenant(session_override)
    session_override.add(
        InboxRule(
            tenant_id=tenant.id,
            match_type="sender",
            match_value="noreply@shop.nl",
            action="auto_close",
            status="active",
        )
    )
    session_override.add(
        InboxRule(
            tenant_id=tenant.id,
            match_type="domain",
            match_value="news.io",
            action="auto_close",
            status="suggested",
        )
    )
    session_override.add(
        PlatformChange(
            tenant_id=tenant.id,
            resource_type="persona_review",
            change_kind="review",
            status="pending_review",
            proposed_by_type="system",
            summary="Review persona",
        )
    )
    await session_override.commit()

    digest = await build_tenant_digest(session_override, tenant.id, period="weekly")
    assert digest["rules_active"] == 1
    assert digest["rules_suggested"] == 1
    assert digest["learning_proposals"] == 1

    lines = digest_paragraphs(digest, tenant.name)
    learning_line = next(line for line in lines if line.startswith("Learning:"))
    assert "1 automation rule(s) active" in learning_line
    assert "1 rule suggestion(s) to review" in learning_line
    assert "1 learning proposal(s) waiting in Govern" in learning_line
