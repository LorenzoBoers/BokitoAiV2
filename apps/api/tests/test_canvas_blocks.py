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
