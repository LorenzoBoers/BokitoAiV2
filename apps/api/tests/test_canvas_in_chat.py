from app.services.agent.loop import AgentLoop


def _loop(*, trust: str = "operator", tools: list[str] | None = None) -> AgentLoop:
    loop = AgentLoop.__new__(AgentLoop)
    loop.trust = trust
    loop.tools = [{"name": n} for n in (tools if tools is not None else ["create_canvas", "edit_canvas"])]
    loop._canvas_placed = False
    loop._canvas_opened = False
    loop._canvas_nudged = False
    loop._canvas_finished = False
    loop._canvas_edit_failures = 0
    loop._CANVAS_EDIT_FAIL_LIMIT = 3
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


def test_copyable_text_fence_stays_in_chat():
    text = (
        "Te plakken na je keuzes.\n\n"
        "```text\n"
        "Antwoord op beide vragen.\n\n"
        "Vraag 1: B.\n"
        "```"
    )
    loop = _loop()
    assert not loop._canvas_in_chat(text)
    assert "Antwoord op beide vragen." in loop._keep_chat_speech(text)


def test_finished_canvas_drops_the_build_log():
    loop = _loop()
    loop._canvas_finished = True
    log = (
        "Het seems dat de bronvermelding niet wordt herkend. "
        "Ik zal de bronvermelding als operator-message gebruiken.\n\n"
        "```markdown\nBerichten: 12\n```"
    )
    assert loop._chat_after_canvas(log) == ""
    assert loop._chat_after_canvas("De cijfers staan naast dit bericht.") == (
        "De cijfers staan naast dit bericht."
    )
    assert loop._chat_after_canvas("Done.") == ""


def test_failed_canvas_edit_drops_the_build_log():
    loop = _loop()
    loop._canvas_finished = False
    loop._canvas_placed = False
    loop._canvas_edit_failures = 2
    log = (
        "Ik probeer de grafiek opnieuw.\n\n"
        "```json\n"
        '{"blocks": [{"type": "bar_chart"}]}\n'
        "```"
    )
    assert loop._canvas_bubble(log) == "Ik probeer de grafiek opnieuw."
    dumped = (
        "Omdat de bronvermelding niet klopt, hier de definitieve aanpak.\n\n"
        "```json\n{}\n```"
    )
    assert loop._canvas_bubble(dumped) == ""


def test_json_blocks_fence_is_dropped_from_chat():
    loop = _loop()
    text = (
        "Hier is de definitieve aanpassing:\n\n"
        "```json\n"
        '{"blocks": [{"type": "stat", "label": "Berichten", "value": "12"}]}\n'
        "```\n"
    )
    assert loop._canvas_in_chat(text)
    assert loop._keep_chat_speech(text) == ""
    assert "blocks" not in loop._keep_chat_speech(text)


def test_unfenced_blocks_object_is_canvas_body():
    loop = _loop()
    assert loop._canvas_body_in_text('{"blocks": [{"type": "bar_chart", "title": "X"}]}')


def test_no_nudge_without_tool_or_after_canvas():
    assert not _loop(tools=[])._canvas_in_chat("```x```")
    assert not _loop(trust="external")._canvas_in_chat("```x```")
    loop = _loop()
    loop._canvas_placed = True
    # Plain fence after a placed canvas is not enough; JSX still is.
    assert not loop._canvas_in_chat("```x```")
    assert loop._canvas_in_chat("```jsx\n<Stat title=\"A\" value={1} />\n```")
