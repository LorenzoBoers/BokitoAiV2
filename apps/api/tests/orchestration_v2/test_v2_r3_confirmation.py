"""Rule 3: irreversible actions only after explicit confirmation.

Pass criteria:
  R3.1  Hesitation/ambiguity never resolves an open irreversible card:
        'misschien', 'eh', 'ehm', 'hmm', 'mm-hm', 'ja misschien', 'ik weet het niet',
        'ja?', 'ja, nee wacht' -> match_soft_decision_reply returns no approve.
  R3.2  Explicit Dutch confirmations do resolve it as approve:
        'ja, doe maar', 'Ja, doe maar.', 'ja doe maar', 'doe maar', 'ja, ga je gang',
        'ja graag', 'ja'.
  R3.3  End to end on a real DecisionRequest (in-memory DB): after 'eh',
        'misschien', 'hmm' the card is still awaiting_human; 'ja, doe maar'
        then resolves it. Repeated REPEATS (>= 5) times, same result each time.
  R3.4  The voice dock honours the same rule: an open card
        on the intercom lane is resolved by a spoken 'ja, doe maar' and NOT by
        'misschien' (same rule as the chat Ask, checked before any routing).
"""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from _v2_support import REPEATS

IRREVERSIBLE_OPTIONS = [
    {"id": "send", "label": "Versturen"},
    {"id": "reject", "label": "Annuleren", "action_type": "reject"},
]
AMBIGUOUS = [
    "misschien",
    "eh",
    "ehm",
    "uh",
    "hmm",
    "mm-hm",
    "ja misschien",
    "misschien wel",
    "ik weet het niet",
    "ja?",
    "ja, nee wacht",
]
EXPLICIT_YES = [
    "ja, doe maar",
    "Ja, doe maar.",
    "ja doe maar",
    "doe maar",
    "ja, ga je gang",
    "ja graag",
    "ja",
]


@pytest.mark.parametrize("text", AMBIGUOUS)
def test_r3_ambiguous_never_approves(text):
    from app.services.thread_ask import match_soft_decision_reply

    for _ in range(REPEATS):
        hit = match_soft_decision_reply(text, IRREVERSIBLE_OPTIONS)
        assert hit is None or hit.get("action") != "approve", (text, hit)


@pytest.mark.parametrize("text", EXPLICIT_YES)
def test_r3_explicit_yes_approves(text):
    from app.services.thread_ask import match_soft_decision_reply

    for _ in range(REPEATS):
        hit = match_soft_decision_reply(text, IRREVERSIBLE_OPTIONS)
        assert hit == {"action": "approve", "option_id": "send"}, (text, hit)


async def _open_card(seeded, signal_id=None):
    from app.models.signal import Signal
    from app.tools.builtin import _propose_action
    from app.tools.registry import ToolContext

    if signal_id is None:
        signal = Signal(
            tenant_id=seeded.tenant.id,
            channel="assistant",
            source="chat",
            subject=f"v2-confirm-{uuid4().hex[:6]}",
            agent_id=seeded.agent.id,
        )
        seeded.session.add(signal)
        await seeded.session.flush()
        signal_id = signal.id
    ctx = ToolContext(
        session=seeded.session,
        tenant_id=seeded.tenant.id,
        user_id=seeded.user.id,
        agent=seeded.agent,
        signal_id=signal_id,
    )
    card = await _propose_action(
        ctx,
        {"question": "Zal ik de factuur van 1.250 euro naar Café Luna versturen?", "options": IRREVERSIBLE_OPTIONS},
    )
    await seeded.session.commit()
    return signal_id, UUID(card["decision_request_id"])


async def _status(session, decision_id):
    from app.models.notification import DecisionRequest

    # Column select: reads the DB row without expiring the seeded ORM objects.
    return (
        await session.execute(select(DecisionRequest.status).where(DecisionRequest.id == decision_id))
    ).scalar_one()


@pytest.mark.parametrize("run", range(REPEATS))
async def test_r3_card_waits_for_explicit_yes(run, seeded):
    from app.services.thread_ask import _soft_decision

    tenant_id, user_id = seeded.tenant.id, seeded.user.id
    signal_id, decision_id = await _open_card(seeded)
    for text in ("eh", "misschien", "hmm"):
        resolved = await _soft_decision(seeded.session, tenant_id, user_id, signal_id, text)
        assert resolved is None, (text, resolved)
        assert await _status(seeded.session, decision_id) == "awaiting_human", text
    resolved = await _soft_decision(seeded.session, tenant_id, user_id, signal_id, "ja, doe maar")
    assert resolved is not None and resolved.get("action") == "approve", (
        f"R3.2/R3.3: 'ja, doe maar' did not confirm the open card: {resolved!r}"
    )
    assert await _status(seeded.session, decision_id) != "awaiting_human"


@pytest.mark.parametrize("run", range(REPEATS))
async def test_r3_voice_dock_uses_same_confirmation_rule(run, seeded, fake_voice, timeline, route_fake):
    from app.services.conversation_moves import intercom_lane
    from app.services.intercom import handle_utterance

    lane = await intercom_lane(
        seeded.session, seeded.tenant.id, seeded.user.id, seeded.agent, user_name=seeded.user.display_name
    )
    _, decision_id = await _open_card(seeded, signal_id=lane.id)

    async def say(text):
        fake_voice.transcript = text
        return await handle_utterance(
            seeded.session,
            seeded.tenant.id,
            seeded.user,
            agent_id=seeded.agent.id,
            audio=b"fake-webm",
            filename="n.webm",
            mime="audio/webm",
        )

    await say("misschien")
    assert await _status(seeded.session, decision_id) == "awaiting_human"
    await say("ja, doe maar")
    assert await _status(seeded.session, decision_id) != "awaiting_human"
