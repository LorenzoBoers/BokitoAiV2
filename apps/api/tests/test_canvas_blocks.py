"""Typed dashboard blocks: validate, render, and round-trip to the tree."""

from app.services.canvas_blocks import (
    bind_source_ledger,
    blocks_to_tree,
    note_turn_tool,
    polish_blocks,
    render_problems,
    reset_source_ledger,
    tree_to_blocks,
    validate_blocks,
)


def _chart() -> dict:
    return {
        "type": "bar_chart",
        "title": "Frequentie",
        "labels": ["1", "2"],
        "series": [{"name": "Aantal", "values": [3, 5]}],
    }


def test_length_mismatch_names_the_series():
    raw = {
        "type": "bar_chart",
        "title": "Frequentie",
        "labels": ["1", "2", "3"],
        "series": [{"name": "Aantal", "values": [3, 5]}],
    }
    blocks, errors = validate_blocks([raw])
    assert blocks == []
    assert any("2 values for 3 labels" in error for error in errors)
    assert errors[0].startswith("blocks[0].series[0].values")


def test_unknown_type_names_the_replacements():
    _blocks, errors = validate_blocks([{"type": "BoxPlot", "title": "Spread"}])
    assert errors
    assert "box_plot" in errors[0]
    assert "bar_chart, line_chart, area_chart, pie_chart, stat, table" in errors[0]


def test_label_alias_and_numeric_strings():
    blocks, errors = validate_blocks(
        [
            {
                "type": "bar_chart",
                "title": "Frequentie",
                "labels": [1, 2],
                "series": [{"label": "Aantal", "values": ["3", "5"]}],
            }
        ]
    )
    assert errors == []
    assert blocks[0]["series"][0]["name"] == "Aantal"
    assert blocks[0]["series"][0]["values"] == [3.0, 5.0]


def test_data_rows_become_series():
    blocks, errors = validate_blocks(
        [
            {
                "type": "line_chart",
                "title": "Trend",
                "data": [{"label": "jan", "value": 1}, {"label": "feb", "value": 2}],
            }
        ]
    )
    assert errors == []
    assert blocks[0]["labels"] == ["jan", "feb"]
    assert blocks[0]["series"][0]["values"] == [1.0, 2.0]


def test_render_problems_reject_empty_and_zero_charts():
    zeros, errors = validate_blocks(
        [
            {
                "type": "bar_chart",
                "title": "Leeg",
                "labels": ["1"],
                "series": [{"name": "A", "values": [0]}],
            }
        ]
    )
    assert errors == []
    assert render_problems(zeros) == ["blocks[0]: chart values are all zero"]

    pie, pie_errors = validate_blocks(
        [{"type": "pie_chart", "title": "Verdeling", "slices": [{"name": "A", "value": 0}]}]
    )
    assert pie_errors == []
    assert render_problems(pie) == ["blocks[0]: pie chart has no slices"]


def test_tree_round_trip_keeps_chart_points():
    blocks, errors = validate_blocks(
        [
            {"type": "heading", "text": "Getallen", "level": 2},
            _chart(),
            {
                "type": "card",
                "title": "Kern",
                "blocks": [{"type": "stat", "label": "Gemiddelde", "value": "4,5"}],
            },
        ]
    )
    assert errors == []
    tree = blocks_to_tree(blocks)
    panel = tree["children"][1]
    assert panel["type"] == "Card"
    assert panel["props"] == {"title": "Frequentie", "auto": True}
    chart = panel["children"][0]
    assert chart["type"] == "BarChart"
    assert chart["props"]["series"][0]["points"] == [
        {"x": "1", "y": 3.0},
        {"x": "2", "y": 5.0},
    ]
    again = tree_to_blocks(tree)
    assert again[1]["title"] == "Frequentie"
    assert again[1]["labels"] == ["1", "2"]
    assert again[1]["series"][0]["values"] == [3.0, 5.0]
    assert again[2]["type"] == "card"
    assert again[2]["blocks"][0]["value"] == "4,5"


def test_layout_builds_kpi_row_hero_and_pairs():
    blocks, errors = validate_blocks(
        [
            {"type": "heading", "text": "Omzet 12% boven plan"},
            {"type": "stat", "label": "Omzet", "value": "84k", "delta": 12},
            {"type": "stat", "label": "Marge", "value": "31%", "status": "warning"},
            {"type": "stat", "label": "Klanten", "value": "412", "delta": "-3%"},
            {**_chart(), "type": "line_chart", "title": "Trend"},
            {**_chart(), "title": "Per regio"},
            {**_chart(), "title": "Per product", "type": "area_chart", "stacked": True},
            {"type": "table", "columns": ["A"], "rows": [["1"]]},
        ]
    )
    assert errors == []
    kids = blocks_to_tree(blocks)["children"]
    assert [kid["type"] for kid in kids] == ["Heading", "Grid", "Card", "Grid", "Table"]
    assert kids[1]["props"]["columns"] == 3
    omzet, marge, klanten = (tile["props"] for tile in kids[1]["children"])
    assert omzet["tile"] and omzet["delta"] == "+12" and omzet["trend"] == "up"
    assert marge["status"] == "watch"
    assert klanten["trend"] == "down"
    assert kids[2]["props"]["title"] == "Trend"
    assert [card["props"]["title"] for card in kids[3]["children"]] == ["Per regio", "Per product"]
    assert kids[3]["children"][1]["children"][0]["type"] == "AreaChart"

    again = tree_to_blocks(blocks_to_tree(blocks))
    assert [block["type"] for block in again] == [block["type"] for block in blocks]
    assert again[6]["stacked"] is True


def test_wide_chart_breaks_the_pairs():
    blocks, _ = validate_blocks([_chart(), {**_chart(), "wide": True}, _chart()])
    kids = blocks_to_tree(blocks)["children"]
    assert [kid["type"] for kid in kids] == ["Card", "Card", "Card"]


def test_polish_turns_a_crowded_pie_into_sorted_bars():
    slices = [{"name": f"P{i}", "value": i} for i in range(1, 9)]
    blocks, errors = validate_blocks([{"type": "pie_chart", "title": "Mix", "slices": slices}])
    assert errors == []
    polished, notes = polish_blocks(blocks)
    assert polished[0]["type"] == "bar_chart"
    assert polished[0]["labels"][0] == "P8"
    assert any("sorted bar_chart" in note for note in notes)
    assert any("heading" in note for note in notes)


def test_grid_of_cards_is_columns():
    blocks, errors = validate_blocks(
        [
            {
                "type": "grid",
                "columns": 2,
                "blocks": [{"type": "card", "title": "Links", "blocks": [_chart()]}, _chart()],
            }
        ]
    )
    assert errors == []
    tree = blocks_to_tree(blocks)
    assert tree["children"][0]["type"] == "Grid"
    assert tree["children"][0]["children"][0]["type"] == "Card"
    assert tree_to_blocks(tree)[0]["blocks"][0]["type"] == "card"


def test_grid_inside_a_card_is_refused():
    _blocks, errors = validate_blocks(
        [{"type": "card", "title": "Uit", "blocks": [{"type": "grid", "blocks": [_chart()]}]}]
    )
    assert any("grid sits at the top level" in error for error in errors)


def test_tree_shaped_blocks_with_props_are_accepted():
    """The shape the model sent on thread 803e9d00: fields under props, PascalCase types."""
    raw = [
        {
            "type": "grid",
            "props": {
                "columns": 2,
                "blocks": [
                    {
                        "type": "card",
                        "props": {
                            "title": "Frequentie en Trends",
                            "blocks": [
                                {
                                    "type": "bar_chart",
                                    "props": {
                                        "title": "Frequentie",
                                        "labels": ["1", "2"],
                                        "series": [{"name": "F", "values": [3, 5]}],
                                    },
                                }
                            ],
                        },
                    },
                    {
                        "type": "Card",
                        "props": {"title": "Kern"},
                        "children": [
                            {
                                "type": "BarChart",
                                "props": {"xAxisTitle": "Getal", "labels": ["a"], "series": [{"name": "F", "values": [1]}]},
                            }
                        ],
                    },
                ],
            },
        }
    ]
    blocks, errors = validate_blocks(raw)
    assert errors == []
    card = blocks[0]["blocks"][1]
    assert card["blocks"][0]["x_label"] == "Getal"


def test_one_clear_error_per_bad_block():
    _blocks, errors = validate_blocks([{"type": "grid", "columns": 2}])
    assert errors == ["blocks[0].blocks: expected a list of blocks"]


_SOURCE = {"tool": "list_threads", "tool_use_id": "toolu_1", "as_of": "2026-10-22T17:00:00"}


def test_source_round_trips_through_the_tree():
    raw = [
        {"type": "stat", "label": "Open", "value": "4", "source": dict(_SOURCE)},
        {**_chart(), "source": dict(_SOURCE)},
        {
            "type": "pie_chart",
            "title": "Kanalen",
            "slices": [{"name": "Mail", "value": 3}, {"name": "Chat", "value": 1}],
            "source": dict(_SOURCE),
        },
        {
            "type": "table",
            "title": "Wachtrij",
            "columns": ["Titel"],
            "rows": [["Login"]],
            "source": dict(_SOURCE),
        },
    ]
    cleaned, errors = validate_blocks(raw)
    assert errors == []
    back = tree_to_blocks(blocks_to_tree(cleaned))
    assert [block["source"] for block in back] == [dict(_SOURCE), dict(_SOURCE), dict(_SOURCE), dict(_SOURCE)]


def test_turn_stamps_tool_and_time_from_the_ledger():
    ledger = {"toolu_1": {"tool": "list_threads", "as_of": "2026-10-22T17:00:00"}}
    token = bind_source_ledger(ledger)
    try:
        cleaned, errors = validate_blocks(
            [
                {
                    "type": "card",
                    "title": "Kern",
                    "blocks": [
                        {
                            "type": "stat",
                            "label": "Open",
                            "value": "4",
                            "source": {"tool_use_id": "toolu_1", "tool": "list_threads", "as_of": "1999-01-01"},
                        }
                    ],
                }
            ]
        )
    finally:
        reset_source_ledger(token)
    assert errors == []
    assert cleaned[0]["blocks"][0]["source"] == _SOURCE


def test_source_nested_in_series_lands_on_the_chart():
    ledger = {"toolu_1": {"tool": "list_threads", "as_of": "2026-10-22T17:00:00"}}
    token = bind_source_ledger(ledger)
    try:
        cleaned, errors = validate_blocks(
            [
                {
                    "type": "bar_chart",
                    "title": "Open",
                    "labels": ["Nu"],
                    "series": [
                        {"name": "Gesprekken", "values": [25]},
                        {"source": {"tool_use_id": "toolu_1"}},
                    ],
                }
            ]
        )
    finally:
        reset_source_ledger(token)
    assert errors == []
    assert cleaned[0]["source"] == _SOURCE
    assert cleaned[0]["series"] == [{"name": "Gesprekken", "values": [25.0]}]


def test_turn_rejects_a_number_without_a_call_from_this_turn():
    token = bind_source_ledger({})
    try:
        _blocks, missing = validate_blocks([{"type": "stat", "label": "Open", "value": "4"}])
        _blocks, unknown = validate_blocks(
            [{"type": "stat", "label": "Open", "value": "4", "source": {"tool_use_id": "toolu_missing"}}]
        )
    finally:
        reset_source_ledger(token)
    assert any("tool_use_id" in error for error in missing)
    assert any("tool_use_id" in error for error in unknown)
    token = bind_source_ledger({"toolu_1": {"tool": "list_threads", "as_of": "2026-10-22T17:00:00"}})
    try:
        _blocks, lied = validate_blocks(
            [
                {
                    "type": "bar_chart",
                    "title": "Frequentie",
                    "labels": ["1"],
                    "series": [{"name": "Aantal", "values": [3]}],
                    "source": {"tool_use_id": "toolu_1", "tool": "other"},
                }
            ]
        )
    finally:
        reset_source_ledger(token)
    assert any("does not match" in error for error in lied)
    assert any("list_threads" in error for error in lied)


def test_turn_rejects_figures_that_are_not_in_the_tool_result():
    ledger = {
        "toolu_1": {
            "tool": "get_tenant_overview",
            "as_of": "2026-10-23T20:10:43",
            "figures": "4 17",
        }
    }
    token = bind_source_ledger(ledger)
    try:
        _blocks, errors = validate_blocks(
            [
                {
                    "type": "stat",
                    "label": "Aantal posts",
                    "value": "12",
                    "delta": "+15%",
                    "source": {"tool_use_id": "toolu_1", "tool": "get_tenant_overview"},
                }
            ]
        )
    finally:
        reset_source_ledger(token)
    assert any("12 is not in the get_tenant_overview result" in error for error in errors)
    assert any("Do not invent figures" in error for error in errors)


def test_thousand_dot_matches_the_integer_in_the_result():
    ledger = {
        "toolu_1": {
            "tool": "list_threads",
            "as_of": "2026-10-22T17:00:00",
            "figures": "52000",
        }
    }
    token = bind_source_ledger(ledger)
    try:
        cleaned, errors = validate_blocks(
            [
                {
                    "type": "stat",
                    "label": "Bereik",
                    "value": "52.000",
                    "source": {"tool_use_id": "toolu_1"},
                }
            ]
        )
    finally:
        reset_source_ledger(token)
    assert errors == []
    assert cleaned[0]["source"]["tool"] == "list_threads"


def test_operator_message_is_a_source_for_numbers_they_wrote():
    from app.services.canvas_blocks import note_operator_message

    ledger: dict = {}
    note_operator_message(ledger, "Maak een dashboard: Berichten 12, Goedgekeurd 9, Bewaard 3.")
    token = bind_source_ledger(ledger)
    try:
        cleaned, errors = validate_blocks(
            [
                {"type": "heading", "text": "Kerncijfers", "level": 2},
                {"type": "stat", "label": "Berichten", "value": "12", "source": {"tool_use_id": "operator-message"}},
                {"type": "stat", "label": "Verzonnen", "value": "99", "source": {"tool_use_id": "operator-message"}},
            ]
        )
    finally:
        reset_source_ledger(token)
    assert errors
    assert "99" in errors[0]
    assert cleaned == []
    assert render_problems([{"type": "heading", "text": "Alleen een titel"}])


def test_operator_message_ignores_a_wrong_tool_label():
    from app.services.canvas_blocks import note_operator_message

    ledger: dict = {}
    note_operator_message(ledger, "Berichten 12")
    token = bind_source_ledger(ledger)
    try:
        cleaned, errors = validate_blocks(
            [
                {
                    "type": "stat",
                    "label": "Berichten",
                    "value": "12",
                    "source": {"tool_use_id": "operator-message", "tool": "Lorenzo Boers"},
                }
            ]
        )
    finally:
        reset_source_ledger(token)
    assert errors == []
    assert cleaned[0]["source"]["tool"] == "operator"


def test_canvas_figures_seed_operator_message():
    from app.services.canvas_blocks import note_canvas_figures

    ledger: dict = {}
    note_canvas_figures(
        ledger,
        [
            {"type": "stat", "label": "Berichten", "value": "12"},
            {"type": "stat", "label": "Goedgekeurd", "value": "9"},
        ],
    )
    token = bind_source_ledger(ledger)
    try:
        cleaned, errors = validate_blocks(
            [
                {
                    "type": "bar_chart",
                    "title": "Verloop",
                    "labels": ["Berichten", "Goedgekeurd"],
                    "series": [{"name": "Aantal", "values": [12, 9]}],
                    "source": {"tool_use_id": "operator-message"},
                }
            ]
        )
    finally:
        reset_source_ledger(token)
    assert errors == []
    assert cleaned[0]["type"] == "bar_chart"


def test_note_turn_tool_records_figures_from_the_result():
    ledger: dict = {}
    note_turn_tool(ledger, "toolu_1", "get_tenant_overview", ok=True, result={"agents": 4, "open": "17"})
    assert "4" in ledger["toolu_1"]["figures"].split()
    assert "17" in ledger["toolu_1"]["figures"].split()


def test_outside_a_turn_a_number_does_not_need_a_source():
    cleaned, errors = validate_blocks([{"type": "stat", "label": "Open", "value": "4", "source": {"tool_use_id": "toolu_1"}}])
    assert errors == []
    assert "source" not in cleaned[0]


def test_note_turn_tool_skips_canvas_writes_and_failures():
    ledger: dict = {}
    note_turn_tool(ledger, "toolu_1", "list_threads", ok=True)
    note_turn_tool(ledger, "toolu_2", "edit_canvas", ok=True)
    note_turn_tool(ledger, "toolu_3", "list_threads", ok=False)
    assert list(ledger) == ["toolu_1"]
    assert ledger["toolu_1"]["tool"] == "list_threads"
    assert ledger["toolu_1"]["as_of"]


def test_tool_result_for_model_puts_the_call_id_in_the_body():
    from app.services.canvas_blocks import tool_result_for_model

    stamped = tool_result_for_model("list_threads", {"threads": []}, "toolu_1")
    assert stamped["tool_use_id"] == "toolu_1"
    assert stamped["threads"] == []
    assert tool_result_for_model("edit_canvas", {"status": "applied"}, "toolu_2") == {
        "status": "applied"
    }
    failed = {"error": "nope"}
    assert tool_result_for_model("list_threads", failed, "toolu_3") is failed


def test_citeable_calls_follow_the_ledger():
    from app.services.canvas_blocks import citeable_calls

    token = bind_source_ledger({"toolu_1": {"tool": "list_threads", "as_of": "2026-10-22T17:00:00"}})
    try:
        assert citeable_calls() == [("list_threads", "toolu_1")]
    finally:
        reset_source_ledger(token)


def test_keep_editable_blocks_cites_operator_when_canvas_has_figures():
    from app.services.canvas_blocks import OPERATOR_SOURCE_ID, keep_editable_blocks, note_canvas_figures

    ledger: dict = {}
    note_canvas_figures(ledger, [{"type": "stat", "label": "Open", "value": "4"}])
    kept = keep_editable_blocks(
        [
            {"type": "heading", "text": "Overzicht"},
            {"type": "stat", "label": "Open", "value": "4"},
        ],
        ledger,
    )
    assert len(kept) == 2
    assert kept[1]["source"]["tool_use_id"] == OPERATOR_SOURCE_ID
    assert "4" in ledger[OPERATOR_SOURCE_ID]["figures"]


def test_keep_editable_blocks_drops_unsourced_stats_without_figures():
    from app.services.canvas_blocks import keep_editable_blocks

    kept = keep_editable_blocks(
        [
            {"type": "heading", "text": "Overzicht"},
            {"type": "stat", "label": "Verzonnen", "value": "99"},
        ],
        {},
    )
    assert kept == [{"type": "heading", "text": "Overzicht"}]
