"""Agent loop nudges when the model only announces work without tools."""

from app.services.agent.loop import AgentLoop


def test_looks_like_work_announce_dutch_and_english():
    loop = object.__new__(AgentLoop)
    assert loop._looks_like_work_announce(
        "Ik ga de meldingen van Harold als bugmeldingen opnemen. Even kijken welke projecten beschikbaar zijn."
    )
    assert loop._looks_like_work_announce("Let me check which projects are available.")
    assert loop._looks_like_work_announce("Oké, ik begin.")
    assert not loop._looks_like_work_announce("4")
    assert not loop._looks_like_work_announce("OK")
    assert not loop._looks_like_work_announce("Het ticket staat open onder #bug.")


def test_looks_like_unfinished_story():
    loop = object.__new__(AgentLoop)
    loop._turn_user_text = "Vertel me eens een verhaaltje in meerdere berichten"
    assert loop._looks_like_unfinished_story(
        "Oké, ik begin.\n\nEr was eens een klein platform genaamd Bokito."
    )
    loop._turn_user_text = "Wat is de beste agenda koppeling?"
    assert not loop._looks_like_unfinished_story("Google Calendar is al actief.")


def test_chat_style_requires_same_turn_tools():
    from app.services.agent.style import CHAT_STYLE

    assert "same turn" in CHAT_STYLE.lower() or "in the same turn" in CHAT_STYLE
    assert "WhatsApp" in CHAT_STYLE
    assert "Never stop after" in CHAT_STYLE
    assert "bullet or numbered catalogs" in CHAT_STYLE


def test_chat_style_requires_inline_platform_chips():
    from app.services.agent.style import CHAT_STYLE

    assert "@[Name](agent:{id})" in CHAT_STYLE
    assert "never plain bold names" in CHAT_STYLE.lower()
    assert "list_agents" in CHAT_STYLE
    assert "attach_items" in CHAT_STYLE
