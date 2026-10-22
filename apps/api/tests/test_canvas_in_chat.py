from app.services.agent.loop import AgentLoop


def _loop(*, trust: str = "operator", tools: list[str] | None = None) -> AgentLoop:
    loop = AgentLoop.__new__(AgentLoop)
    loop.trust = trust
    loop.tools = [{"name": n} for n in (tools if tools is not None else ["create_canvas"])]
    loop._canvas_placed = False
    loop._canvas_nudged = False
    return loop


def test_mermaid_in_chat_is_a_canvas():
    text = "Hier is de tekening.\n\n```mermaid\ngraph TD\nA-->B\n```"
    assert _loop()._canvas_in_chat(text)


def test_svg_in_chat_is_a_canvas():
    assert _loop()._canvas_in_chat('<svg viewBox="0 0 10 10"></svg>')


def test_long_layout_spec_is_a_canvas():
    spec = "Ontwerp:\n" + "\n".join(f"- onderdeel {i}" for i in range(9))
    assert _loop()._canvas_in_chat(spec)


def test_short_answer_stays_in_chat():
    assert not _loop()._canvas_in_chat("Het is 14 graden.\n\n- morgen 16\n- overmorgen 12")


def test_no_nudge_without_tool_or_after_canvas():
    assert not _loop(tools=[])._canvas_in_chat("```x```")
    assert not _loop(trust="external")._canvas_in_chat("```x```")
    loop = _loop()
    loop._canvas_placed = True
    assert not loop._canvas_in_chat("```x```")
