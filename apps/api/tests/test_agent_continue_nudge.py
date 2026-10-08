"""Agent loop nudges when the model only announces work without tools."""

from app.services.agent.loop import AgentLoop


def test_looks_like_work_announce_dutch_and_english():
    loop = object.__new__(AgentLoop)
    assert loop._looks_like_work_announce(
        "Ik ga de meldingen van Harold als bugmeldingen opnemen. Even kijken welke projecten beschikbaar zijn."
    )
    assert loop._looks_like_work_announce("Let me check which projects are available.")
    assert not loop._looks_like_work_announce("4")
    assert not loop._looks_like_work_announce("OK")
    assert not loop._looks_like_work_announce("Het ticket staat open onder #bug.")


def test_chat_style_requires_same_turn_tools():
    from app.services.agent.style import CHAT_STYLE

    assert "same turn" in CHAT_STYLE.lower() or "in the same turn" in CHAT_STYLE
    assert "Never end after only announcing" in CHAT_STYLE
