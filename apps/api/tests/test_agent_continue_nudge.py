"""Chat style: how an agent works a turn."""


def test_chat_style_has_turn_work_block():
    from app.services.agent.style import CHAT_STYLE, TURN_WORK

    assert TURN_WORK in CHAT_STYLE
    assert "How you work a turn:" in CHAT_STYLE
    assert "start with one short sentence" in CHAT_STYLE
    assert "end with the result, not with an announcement" in CHAT_STYLE
    assert "No announcement" not in CHAT_STYLE
    assert "WhatsApp" in CHAT_STYLE
    assert "bullet or numbered catalogs" in CHAT_STYLE


def test_chat_style_requires_inline_platform_chips():
    from app.services.agent.style import CHAT_STYLE

    assert "@[Name](agent:{id})" in CHAT_STYLE
    assert "never plain bold names" in CHAT_STYLE.lower()
    assert "list_agents" in CHAT_STYLE
    assert "attach_items" in CHAT_STYLE
