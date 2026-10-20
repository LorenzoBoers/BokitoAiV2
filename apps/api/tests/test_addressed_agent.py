"""The composer address comes from the server, not the last clicked agent."""

from types import SimpleNamespace
from uuid import uuid4

from app.services.signal_threads import addressed_agent_payload


def test_live_turn_wins_over_the_owner():
    owner = SimpleNamespace(id=uuid4(), name="Boekhouder")
    signal = SimpleNamespace(
        active_turn_json='{"kind":"agent","ref_id":"11111111-1111-1111-1111-111111111111","name":"Extra test agent","deadline":"2099-01-01T00:00:00"}',
        handoff_session_json="{}",
    )
    payload = addressed_agent_payload(signal, owner)
    assert payload["name"] == "Extra test agent"


def test_owner_when_nothing_else_is_on_the_floor():
    owner = SimpleNamespace(id=uuid4(), name="Boekhouder")
    signal = SimpleNamespace(active_turn_json="{}", handoff_session_json="{}")
    payload = addressed_agent_payload(signal, owner)
    assert payload["name"] == "Boekhouder"
    assert payload["id"] == str(owner.id)
