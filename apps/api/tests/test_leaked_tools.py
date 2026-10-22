"""A model that writes <propose_action> in the reply still raises a real card."""

from app.services.agent.leaked_tools import lift_propose_action_markup

_LEAK = """Zal ik elke 10 minuten een herhalende taak starten die de klantflows scant?

<propose_action
action="set_thread_schedule"
payload='{"new_thread": true, "title": "Statuscheck klantenflows", "every_minutes": 10, "owner": "f669bfed-cc69-4476-9ef7-7c9bc1b206a6", "instructions": "Check de flows.", "enabled": true}'
approve_label="Start herhalende check"
reject_label="Nee, aanpassen"
/>
"""


def test_leaked_propose_action_becomes_a_tool_call():
    clean, calls = lift_propose_action_markup(_LEAK)
    assert "<propose_action" not in clean.lower()
    assert clean.startswith("Zal ik elke 10 minuten")
    assert len(calls) == 1
    tool_input = calls[0]["input"]
    assert calls[0]["name"] == "propose_action"
    assert tool_input["action"] == "set_thread_schedule"
    assert tool_input["approve_label"] == "Start herhalende check"
    assert tool_input["reject_label"] == "Nee, aanpassen"
    assert tool_input["payload"]["every_minutes"] == 10
    assert tool_input["payload"]["new_thread"] is True
    assert tool_input["payload"]["enabled"] is True
    assert "Statuscheck" in tool_input["payload"]["title"]
    assert tool_input["question"].startswith("Zal ik elke 10 minuten")


def test_plain_speech_is_left_alone():
    clean, calls = lift_propose_action_markup("Gewoon een vraag, zonder tag.")
    assert clean == "Gewoon een vraag, zonder tag."
    assert calls == []
