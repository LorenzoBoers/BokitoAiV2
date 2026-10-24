"""Canvas kind guidance: every kind has a purpose, and a text ask is a document.

Mocked: only reads tool schemas and prompt text, no LLM and no database.
"""

import inspect

import app.tools.project_work  # noqa: F401  (registers the canvas tools)
from app.models.project_canvas import CANVAS_KINDS
from app.services.agent import style
from app.tools.registry import get_tool_spec


def _create_canvas():
    spec = get_tool_spec("create_canvas")
    assert spec is not None
    return spec


def test_kind_enum_matches_model_kinds():
    kind = _create_canvas().input_schema["properties"]["kind"]
    assert set(kind["enum"]) == set(CANVAS_KINDS)


def test_every_kind_has_a_purpose_in_the_kind_description():
    text = _create_canvas().input_schema["properties"]["kind"]["description"]
    for kind in CANVAS_KINDS:
        assert f"{kind}:" in text, kind


def test_dashboard_is_for_figures_and_needs_a_sourced_block():
    text = _create_canvas().input_schema["properties"]["kind"]["description"]
    assert "dashboard: numbers to watch (stats, charts, tables)" in text
    assert "needs at least one stat, chart or table" in text


def test_document_covers_quotes_letters_and_reports():
    text = _create_canvas().input_schema["properties"]["kind"]["description"]
    assert "document: a text to read, keep, print or send, such as a quote (offerte)" in text


def test_create_canvas_description_picks_kind_by_content():
    desc = _create_canvas().description
    assert "Choose kind by what the result is, not by the word they use" in desc
    assert "is a document" in desc and "even when they say dashboard" in desc
    assert "kind is dashboard (default)" not in desc


def test_loop_prompt_lists_document_for_offerte_and_all_body_kinds():
    import app.services.agent.loop as loop

    source = inspect.getsource(loop)
    assert "Pick the kind by what the result is, not by the word they use." in source
    assert "- offerte, quote, letter, report, plan" in source
    for kind in ("dashboard", "diagram", "sheet", "drawing", "design", "document", "code", "email", "image"):
        assert f"kind={kind}" in source, kind


def test_operator_style_prompt_chooses_kind_by_content():
    assert "Choose kind by what the result is" in style.CANVAS_OPERATOR_PROMPT
    assert "quote (offerte)" in style.CANVAS_OPERATOR_PROMPT
