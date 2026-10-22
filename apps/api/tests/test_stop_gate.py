"""Stop rule: completion requirement, 8 continuations, stop reasons."""

import pytest
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant
from app.services.agent.loop import AgentLoop
from app.services.agent.stop_gate import (
    ANNOUNCE_REMINDER,
    MAX_STOP_CONTINUATIONS,
    StopGate,
    inbound_requirement,
)


def test_requirement_reminds_until_met():
    gate = StopGate(requirement={"any_of": ["note_no_reply"], "reminder": "Call note_no_reply."})
    first = gate.check(called_ok=set())
    assert "Call note_no_reply." in first and not gate.stop_hook_active
    assert gate.check(called_ok=set()) is not None and gate.stop_hook_active
    assert gate.check(called_ok={"note_no_reply"}) is None
    assert gate.stop_reason() == "end_turn"


def test_limit_forces_stop():
    gate = StopGate(requirement={"any_of": ["x"]})
    reminders = [gate.check(called_ok=set()) for _ in range(MAX_STOP_CONTINUATIONS + 2)]
    assert sum(r is not None for r in reminders) == MAX_STOP_CONTINUATIONS == 8
    assert gate.stop_reason() == "requirement_forced"


def test_no_result_nudge_once_and_queue_first():
    gate = StopGate()
    assert gate.check(called_ok=set()) is None
    assert gate.check(called_ok=set(), no_result_after_tools=True) == ANNOUNCE_REMINDER
    assert gate.check(called_ok=set(), no_result_after_tools=True) is None
    assert gate.check(called_ok=set(), queued_messages="<system-reminder>hi</system-reminder>") == (
        "<system-reminder>hi</system-reminder>"
    )


def test_no_result_signal_is_structural():
    loop = object.__new__(AgentLoop)
    loop.trace_steps = []
    # No tool ran: an announcement alone is not the signal any more.
    assert not loop._no_result_after_tools([{"type": "text", "text": "Ik ga het regelen."}])
    loop.trace_steps = [{"step_type": "tool_call"}]
    assert loop._no_result_after_tools([])
    assert loop._no_result_after_tools([{"type": "text", "text": "  "}])
    assert not loop._no_result_after_tools([{"type": "text", "text": "De flow staat nu op altijd beoordelen."}])


def test_inbound_requirement_lists_outcomes():
    assert set(inbound_requirement()["any_of"]) >= {"suggest_thread_reply", "note_no_reply", "send_reply"}


class _ScriptedLLM:
    """Says 'done' twice, then calls list_tags, then says 'done'."""

    def __init__(self):
        self.calls = 0

    async def chat(self, messages, tools=None, model=None, *, effort=None, max_tokens=None):
        self.calls += 1
        if self.calls == 3:
            return {
                "stop_reason": "tool_use",
                "content": [{"type": "tool_use", "id": "t1", "name": "list_tags", "input": {}}],
                "usage": {"input_tokens": 1, "output_tokens": 1},
            }
        return {"stop_reason": "end_turn", "content": [{"type": "text", "text": "All set."}], "usage": {}}


@pytest.mark.asyncio
async def test_loop_continues_until_requirement_met(client, session_override, monkeypatch):
    tenant = (await session_override.execute(select(Tenant))).scalars().first()
    agent = (await session_override.execute(select(Agent).where(Agent.slug == "assistant"))).scalar_one()
    loop = AgentLoop(session_override, tenant.id, None, agent=agent, trust="operator")
    loop.completion_requirement = {"any_of": ["list_tags"]}
    scripted = _ScriptedLLM()

    async def _prepare(messages, extra_context="", attachments=None):
        loop.llm = scripted
        return [{"role": "system", "content": "s"}, *messages], {"input_tokens": 0, "output_tokens": 0}

    monkeypatch.setattr(loop, "_prepare_chat", _prepare)
    monkeypatch.setattr(loop, "_record_usage", lambda tokens: _noop())
    text, _ = await loop.run_chat([{"role": "user", "content": "Tidy up"}])
    assert text == "All set."
    assert scripted.calls == 4
    assert loop.stop_reason == "end_turn"


async def _noop():
    return None
