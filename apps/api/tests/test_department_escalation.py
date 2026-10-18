"""Department escalation order."""

from uuid import uuid4

from app.services.department_escalation import escalation_sequence
from app.services.teams import MemberRef


def test_escalation_asks_primary_person_then_primary_agent_then_position():
    person = MemberRef("user", uuid4(), "primary", 5)
    agent = MemberRef("agent", uuid4(), "primary", 9)
    backup = MemberRef("user", uuid4(), "backup", 0)
    later = MemberRef("agent", uuid4(), "member", 1)
    ordered = escalation_sequence([later, backup, agent, person])
    assert [ref.duty for ref in ordered[:2]] == ["primary", "primary"]
    assert ordered[0].kind == "user"
    assert ordered[1].kind == "agent"
    assert [ref.position for ref in ordered[2:]] == [0, 1]
