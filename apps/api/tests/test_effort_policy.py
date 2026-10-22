"""One effort per turn: agent setting, greeting shortcut, Kong floor, same on every round."""

import pytest
from sqlalchemy import select

from app.models.agent import Agent
from app.models.auth import Tenant
from app.services.agent.effort_policy import (
    effort_from_budget,
    normalize_effort,
    turn_effort,
    turn_is_small_talk,
)
from app.services.agent.loop import AgentLoop


def test_greeting_runs_low_unless_attached():
    assert turn_effort("high", user_text="hoi") == "low"
    assert turn_effort("high", user_text="Thanks!") == "low"
    assert turn_effort("high", user_text="hoi", has_attachments=True) == "high"


def test_question_keeps_agent_effort():
    for effort in ("low", "medium", "high"):
        assert turn_effort(effort, user_text="Kan je de flow contentmaand op altijd beoordelen zetten?") == effort
    assert turn_effort("", user_text="Waarom krijgt deze klant geen antwoord?") == "medium"


def test_kong_is_at_least_high():
    assert turn_effort("low", user_text="Plan de release", model_slug="bokito-kong") == "high"
    assert turn_effort("medium", user_text="hoi", model_slug="bokito-kong") == "high"


def test_normalize_and_budget_mapping():
    assert normalize_effort("xhigh") == "high"
    assert normalize_effort("max") == "high"
    assert normalize_effort("nonsense") == "medium"
    assert [effort_from_budget(b) for b in (0, 1024, 4096, 16000)] == ["medium", "low", "medium", "high"]
    assert turn_is_small_talk("Hoe is het met jou?")
    assert not turn_is_small_talk("Hoe zet ik WhatsApp aan?")


def test_migration_mapping_matches_policy():
    import importlib.util
    from pathlib import Path

    path = Path(__file__).resolve().parents[1] / "alembic" / "versions" / "146_agent_effort.py"
    spec = importlib.util.spec_from_file_location("m146", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.down_revision == "145_debug_dom"
    sql = module.BUDGET_TO_EFFORT_SQL
    assert "<= 0 THEN 'medium'" in sql
    assert "<= 2048 THEN 'low'" in sql
    assert "<= 8192 THEN 'medium'" in sql
    assert "ELSE 'high'" in sql


def test_snapshot_reads_old_budget_key():
    from app.services.orchestration.profiles import apply_snapshot_to_agent, resolve_runtime_snapshot

    agent = Agent(tenant_id=__import__("uuid").uuid4(), name="A", effort="low")
    assert resolve_runtime_snapshot(agent)["effort"] == "low"
    assert apply_snapshot_to_agent(agent, {"thinking_budget": 16000}).effort == "high"
    assert apply_snapshot_to_agent(agent, {"effort": "medium"}).effort == "medium"
    assert apply_snapshot_to_agent(agent, {}).effort == "low"


class _ActionLLM:
    """Round 1: a sentence and a tool. Round 2: a tool that fails. Round 3: the result."""

    def __init__(self):
        self.efforts: list[str | None] = []

    async def chat(self, messages, tools=None, model=None, *, effort=None, max_tokens=None):
        self.efforts.append(effort)
        n = len(self.efforts)
        if n == 1:
            return {
                "stop_reason": "tool_use",
                "content": [
                    {"type": "text", "text": "Ik zet de flow op altijd beoordelen."},
                    {"type": "tool_use", "id": "t1", "name": "list_tags", "input": {}},
                ],
                "usage": {},
            }
        if n == 2:
            return {
                "stop_reason": "tool_use",
                "content": [{"type": "tool_use", "id": "t2", "name": "no_such_tool", "input": {}}],
                "usage": {},
            }
        return {
            "stop_reason": "end_turn",
            "content": [{"type": "text", "text": "Klaar: de flow vraagt nu altijd om beoordeling."}],
            "usage": {},
        }


@pytest.mark.asyncio
async def test_action_turn_speaks_then_acts_with_one_effort(client, session_override, monkeypatch):
    tenant = (await session_override.execute(select(Tenant))).scalars().first()
    agent = (await session_override.execute(select(Agent).where(Agent.slug == "assistant"))).scalar_one()
    agent.effort = "high"
    loop = AgentLoop(session_override, tenant.id, None, agent=agent, trust="operator")
    scripted = _ActionLLM()

    async def _prepare(messages, extra_context="", attachments=None):
        loop.llm = scripted
        loop._turn_user_text = "Kan je de flow contentmaand op altijd beoordelen zetten?"
        return [{"role": "system", "content": "s"}, *messages], {"input_tokens": 0, "output_tokens": 0}

    async def _noop(_tokens):
        return None

    monkeypatch.setattr(loop, "_prepare_chat", _prepare)
    monkeypatch.setattr(loop, "_record_usage", _noop)
    text, _ = await loop.run_chat(
        [{"role": "user", "content": "Kan je de flow contentmaand op altijd beoordelen zetten?"}]
    )

    assert scripted.efforts == ["high", "high", "high"]
    speech = [str(seg.get("text") or "") for seg in loop.turn.segments if seg.get("text")]
    assert speech[0] == "Ik zet de flow op altijd beoordelen."
    assert speech[-1] == text == "Klaar: de flow vraagt nu altijd om beoordeling."
    assert loop.stop_reason == "end_turn"
