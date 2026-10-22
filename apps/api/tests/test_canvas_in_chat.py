from app.services.agent.loop import AgentLoop


def _loop(*, trust: str = "operator", tools: list[str] | None = None) -> AgentLoop:
    loop = AgentLoop.__new__(AgentLoop)
    loop.trust = trust
    loop.tools = [{"name": n} for n in (tools if tools is not None else ["create_canvas", "edit_canvas"])]
    loop._canvas_placed = False
    loop._canvas_opened = False
    loop._canvas_nudged = False
    return loop


def test_mermaid_in_chat_is_a_canvas():
    text = "Hier is de tekening.\n\n```mermaid\ngraph TD\nA-->B\n```"
    assert _loop()._canvas_in_chat(text)


def test_svg_in_chat_is_a_canvas():
    assert _loop()._canvas_in_chat('<svg viewBox="0 0 10 10"></svg>')


def test_dashboard_jsx_in_chat_is_a_canvas():
    text = (
        "Hier is een uitgebreid dashboard.\n\n"
        "# Bedrijfsanalyses\n\n"
        "<BarChart\n"
        "  data={sales}\n"
        "/>"
    )
    assert _loop()._canvas_in_chat(text)


def test_export_default_canvas_module_in_chat_is_a_canvas():
    text = (
        "Ik zet de grafieken in bokito/canvas.\n\n"
        "```jsx\n"
        "import { Stack, Card, BarChart, Stat } from 'bokito/canvas'\n"
        "export default function Canvas() {\n"
        "  return (\n"
        "    <Stack>\n"
        "      <Card title=\"Frequentie\">\n"
        "        <BarChart data={rows} />\n"
        "      </Card>\n"
        "    </Stack>\n"
        "  )\n"
        "}\n"
        "```"
    )
    loop = _loop()
    assert loop._canvas_in_chat(text)
    assert loop._canvas_chat_opening(text) == "Ik zet de grafieken in bokito/canvas."


def test_jsx_after_a_placed_canvas_still_moves():
    loop = _loop(tools=["create_canvas", "edit_canvas", "update_folder_canvas"])
    loop._canvas_placed = True
    assert loop._canvas_in_chat("Bijgewerkt.\n\n<LineChart data={rows} />")
    assert not loop._canvas_in_chat("Het dashboard staat naast dit bericht.")


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
    # Plain fence after a placed canvas is not enough; JSX still is.
    assert not loop._canvas_in_chat("```x```")
    assert loop._canvas_in_chat("```jsx\n<Stat title=\"A\" value={1} />\n```")
