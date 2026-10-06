"""Decision quality gate: cards without a thread need an executable option;
check-ins can attach a card to a conversation by subject."""

from uuid import uuid4

from sqlalchemy import select

from app.models.auth import Tenant
from app.models.notification import DecisionRequest
from app.models.signal import Signal
from app.tools import execute_tool
from app.tools.builtin import executable_option_actions


def test_executable_actions_ignore_acknowledge_and_defer():
    assert executable_option_actions(
        [
            {"id": "ack", "label": "Acknowledge", "action_type": "acknowledge"},
            {"id": "later", "label": "Later", "action_type": "defer"},
        ]
    ) == []
    assert executable_option_actions(
        [
            {"id": "close", "label": "Close", "action_type": "close_thread"},
            {"id": "later", "label": "Later", "action_type": "defer"},
        ]
    ) == ["close_thread"]
    assert executable_option_actions(
        [{"id": "enable", "label": "Turn on", "action_type": "enable_module"}]
    ) == ["enable_module"]
    assert executable_option_actions(
        [{"id": "answer", "label": "Answer", "input_type": "text"}]
    ) == ["text"]
    assert executable_option_actions(
        [{"id": "x", "label": "Made up", "action_type": "call_customer"}]
    ) == []


async def _tenant(session) -> Tenant:
    tenant = Tenant(slug=f"gate-{uuid4().hex[:8]}", name="Gate")
    session.add(tenant)
    await session.commit()
    return tenant


async def _decisions(session, tenant_id):
    return (
        await session.execute(
            select(DecisionRequest).where(DecisionRequest.tenant_id == tenant_id)
        )
    ).scalars().all()


async def test_signal_less_note_card_is_not_raised(session_override):
    tenant = await _tenant(session_override)
    result = await execute_tool(
        session_override,
        tenant.id,
        None,
        "create_decision_request",
        {
            "title": "No reply needed",
            "summary": "Newsletter from a vendor.",
            "options": [
                {"id": "ack", "label": "Acknowledge", "action_type": "acknowledge"},
                {"id": "later", "label": "Later", "action_type": "defer"},
            ],
        },
    )
    assert result["ok"] is False
    assert result["code"] == "no_executable_option"
    assert await _decisions(session_override, tenant.id) == []


async def test_signal_less_card_with_tool_option_is_raised(session_override):
    tenant = await _tenant(session_override)
    result = await execute_tool(
        session_override,
        tenant.id,
        None,
        "create_decision_request",
        {
            "title": "Turn on Banking?",
            "options": [
                {"id": "enable", "label": "Turn on", "action_type": "enable_module"},
                {"id": "later", "label": "Later", "action_type": "defer"},
            ],
        },
    )
    assert result["status"] == "awaiting_human"
    assert len(await _decisions(session_override, tenant.id)) == 1


async def test_thread_subject_attaches_card_to_the_conversation(session_override):
    tenant = await _tenant(session_override)
    signal = Signal(
        tenant_id=tenant.id,
        channel="email",
        subject="FW: Benodigde gegevens aangifte IB 2025",
        status="open",
    )
    closed = Signal(
        tenant_id=tenant.id,
        channel="email",
        subject="Benodigde gegevens aangifte IB 2024",
        status="closed",
    )
    session_override.add_all([signal, closed])
    await session_override.commit()

    result = await execute_tool(
        session_override,
        tenant.id,
        None,
        "create_decision_request",
        {
            "title": "Follow up on the IB 2025 request?",
            "thread_subject": "aangifte IB 2025",
            "options": [
                {"id": "ack", "label": "I will follow up", "action_type": "acknowledge"},
                {"id": "later", "label": "Later", "action_type": "defer"},
            ],
        },
    )
    assert result["status"] == "awaiting_human"
    rows = await _decisions(session_override, tenant.id)
    assert len(rows) == 1
    assert rows[0].signal_id == signal.id

    # An unknown subject falls back to the gate.
    miss = await execute_tool(
        session_override,
        tenant.id,
        None,
        "create_decision_request",
        {
            "title": "Follow up?",
            "thread_subject": "does not exist anywhere",
            "options": [{"id": "ack", "label": "Ok", "action_type": "acknowledge"}],
        },
    )
    assert miss["code"] == "no_executable_option"
