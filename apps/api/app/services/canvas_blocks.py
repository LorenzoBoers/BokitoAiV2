"""Dashboard canvases are a list of typed blocks, not JSX.

The model fills ``blocks`` on edit_canvas. This module checks that list, turns
it into the tree the dashboard already renders, and reads a stored tree back
as blocks.
"""

from __future__ import annotations

import json
import re
from contextvars import ContextVar, Token
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError

EMPTY_TREE: dict[str, Any] = {"type": "Stack", "props": {}, "children": []}

BLOCK_TYPES = (
    "heading",
    "text",
    "callout",
    "stat",
    "bar_chart",
    "line_chart",
    "area_chart",
    "pie_chart",
    "table",
    "list",
    "divider",
    "grid",
    "card",
)
_CHART_HINT = "bar_chart, line_chart, area_chart, pie_chart, stat, table"
_XY_CHARTS = ("bar_chart", "line_chart", "area_chart")
_CHARTS = (*_XY_CHARTS, "pie_chart")
_NUMBER_BLOCKS = ("stat", *_CHARTS, "table")
# Writing the canvas is not a reading of a number.
_NOT_A_SOURCE = frozenset(
    {"create_canvas", "edit_canvas", "update_folder_canvas", "finish_canvas", "restore_canvas"}
)
# Figures the operator typed in this message. Not a tool read.
OPERATOR_SOURCE_ID = "operator-message"
# Tool calls finished earlier in this agent turn. None means "not a turn".
_SOURCE_LEDGER: ContextVar[dict[str, dict[str, str]] | None] = ContextVar(
    "canvas_source_ledger", default=None
)

_TYPE_ALIASES = {
    "heading": "heading",
    "h1": "heading",
    "h2": "heading",
    "h3": "heading",
    "title": "heading",
    "text": "text",
    "paragraph": "text",
    "callout": "callout",
    "note": "callout",
    "stat": "stat",
    "kpi": "stat",
    "metric": "stat",
    "bar_chart": "bar_chart",
    "barchart": "bar_chart",
    "bar": "bar_chart",
    "line_chart": "line_chart",
    "linechart": "line_chart",
    "line": "line_chart",
    "area_chart": "area_chart",
    "areachart": "area_chart",
    "area": "area_chart",
    "pie_chart": "pie_chart",
    "donut": "pie_chart",
    "donut_chart": "pie_chart",
    "piechart": "pie_chart",
    "pie": "pie_chart",
    "table": "table",
    "list": "list",
    "divider": "divider",
    "hr": "divider",
    "grid": "grid",
    "card": "card",
}

_NODE_TO_BLOCK = {
    "Heading": "heading",
    "Text": "text",
    "Callout": "callout",
    "Stat": "stat",
    "Table": "table",
    "BarChart": "bar_chart",
    "LineChart": "line_chart",
    "AreaChart": "area_chart",
    "PieChart": "pie_chart",
    "List": "list",
    "Divider": "divider",
    "Grid": "grid",
    "Card": "card",
    "Badge": "text",
}

_CALLOUT_TONES = {"info", "warning", "success", "danger"}
_CONTAINERS = {"grid", "card"}


def is_empty_tree(tree: Any) -> bool:
    if isinstance(tree, str):
        try:
            tree = json.loads(tree)
        except json.JSONDecodeError:
            return True
    if not isinstance(tree, dict):
        return True
    children = tree.get("children") or []
    props = tree.get("props") or {}
    return tree.get("type") == "Stack" and not children and not props


class _Block(BaseModel):
    model_config = ConfigDict(extra="ignore")


class BlockSource(BaseModel):
    """Where one number came from. The server fills tool and as_of."""

    model_config = ConfigDict(extra="ignore")
    tool: str = Field(min_length=1, max_length=80)
    tool_use_id: str = Field(min_length=1, max_length=128)
    as_of: str = Field(min_length=1, max_length=40)


class HeadingBlock(_Block):
    type: Literal["heading"]
    text: str = Field(min_length=1, max_length=400)
    level: int = 2


class TextBlock(_Block):
    type: Literal["text"]
    text: str = Field(min_length=1, max_length=4000)


class CalloutBlock(_Block):
    type: Literal["callout"]
    text: str = Field(min_length=1, max_length=2000)
    tone: str = "info"


class StatBlock(_Block):
    type: Literal["stat"]
    label: str = Field(min_length=1, max_length=120)
    value: str = Field(min_length=1, max_length=80)
    unit: str | None = None
    hint: str | None = None
    delta: str | None = Field(default=None, max_length=40)
    trend: Literal["up", "down", "flat"] | None = None
    status: Literal["good", "watch", "bad"] | None = None
    target: str | None = Field(default=None, max_length=80)
    spark: list[float] | None = None
    source: BlockSource | None = None


class SeriesBlock(_Block):
    name: str = Field(min_length=1, max_length=80)
    values: list[float] = Field(min_length=1)


class ChartBlock(_Block):
    type: Literal["bar_chart", "line_chart", "area_chart"]
    title: str = Field(default="", max_length=160)
    labels: list[str] = Field(min_length=1)
    series: list[SeriesBlock] = Field(min_length=1)
    x_label: str | None = None
    y_label: str | None = None
    stacked: bool = False
    wide: bool = False
    source: BlockSource | None = None


class SliceBlock(_Block):
    name: str = Field(min_length=1, max_length=80)
    value: float


class PieBlock(_Block):
    type: Literal["pie_chart"]
    title: str = Field(default="", max_length=160)
    slices: list[SliceBlock] = Field(min_length=1)
    wide: bool = False
    source: BlockSource | None = None


class TableBlock(_Block):
    type: Literal["table"]
    title: str | None = None
    columns: list[str] = Field(min_length=1)
    rows: list[list[str | float | int]] = Field(min_length=1)
    source: BlockSource | None = None


class ListBlock(_Block):
    type: Literal["list"]
    items: list[str] = Field(min_length=1)


class DividerBlock(_Block):
    type: Literal["divider"]


_Leaf = Annotated[
    HeadingBlock | TextBlock | CalloutBlock | StatBlock | ChartBlock | PieBlock | TableBlock | ListBlock | DividerBlock,
    Field(discriminator="type"),
]


class CardBlock(_Block):
    type: Literal["card"]
    title: str = Field(min_length=1, max_length=160)
    blocks: list[_Leaf] = Field(min_length=1)


class GridBlock(_Block):
    type: Literal["grid"]
    columns: int = 2
    blocks: list[
        Annotated[
            HeadingBlock | TextBlock | CalloutBlock | StatBlock | ChartBlock | PieBlock | TableBlock | ListBlock | DividerBlock | CardBlock,
            Field(discriminator="type"),
        ]
    ] = Field(min_length=1)


_ANY = Annotated[
    HeadingBlock
    | TextBlock
    | CalloutBlock
    | StatBlock
    | ChartBlock
    | PieBlock
    | TableBlock
    | ListBlock
    | DividerBlock
    | GridBlock
    | CardBlock,
    Field(discriminator="type"),
]
_LEAF_ADAPTER: TypeAdapter[Any] = TypeAdapter(_Leaf)
_ANY_ADAPTER: TypeAdapter[Any] = TypeAdapter(_ANY)


def blocks_json_schema() -> dict[str, Any]:
    """Tool-schema fragment for one dashboard body."""
    schema = TypeAdapter(list[_ANY]).json_schema()
    schema["description"] = (
        "Dashboard body as a flat, ordered list; the server lays it out. "
        "Consecutive stats become one KPI row; consecutive charts share columns "
        "(wide=true keeps a chart full width). Fields sit on the block itself, "
        "not under props. Charts use labels plus series of {name, values} with "
        "the same length as labels. A stat can carry delta ('+12%'), status "
        "(good, watch, bad), target and spark (a few numbers). "
        "Every stat, chart, pie and table carries source.tool_use_id copied "
        "exactly from the tool_use_id field on the tool result that produced "
        "the number. Copy only numbers that appear in that result. "
        "Numbers the operator wrote in this message use source.tool_use_id "
        "operator-message. "
        "Do not invent an id, a tool name, or a figure. The server sets the tool name and time. "
        f"Types: {', '.join(BLOCK_TYPES)}."
    )
    return schema


def bind_source_ledger(ledger: dict[str, dict[str, str]]) -> Token:
    """Publish this turn's finished tool calls while a tool runs."""
    return _SOURCE_LEDGER.set(ledger)


def reset_source_ledger(token: Token) -> None:
    _SOURCE_LEDGER.reset(token)


def source_ledger() -> dict[str, dict[str, str]] | None:
    return _SOURCE_LEDGER.get()


def _merge_operator_figures(
    ledger: dict[str, dict[str, str]], tokens: set[str], text: str = ""
) -> None:
    """Union figures (and their words) onto the operator-message ledger entry."""
    if not tokens:
        return
    from app.core.time import utcnow

    existing = ledger.get(OPERATOR_SOURCE_ID)
    prior = existing if isinstance(existing, dict) else {}
    if prior.get("figures"):
        tokens |= {part for part in str(prior["figures"]).split() if part}
    ledger[OPERATOR_SOURCE_ID] = {
        "tool": "operator",
        "as_of": str(prior.get("as_of") or utcnow().isoformat(timespec="seconds")),
        "figures": " ".join(sorted(tokens)[:400]),
        "text": " | ".join(part for part in (str(prior.get("text") or ""), text) if part)[:_TEXT_CAP],
    }


def note_operator_message(ledger: dict[str, dict[str, str]], text: str) -> None:
    """Let a dashboard cite numbers the operator wrote in this message.

    A live figure still has to come from a tool. A figure they dictated is
    theirs: the tile says so, and a number that is not in their words is refused.
    """
    tokens: set[str] = set()
    for match in _FIGURE_IN_TEXT.finditer(text or ""):
        token = _canon_figure(match.group(0))
        if token:
            tokens.add(token)
        if len(tokens) >= 400:
            break
    _merge_operator_figures(ledger, tokens, _norm_text(text))


def note_canvas_figures(ledger: dict[str, dict[str, str]], body: Any) -> None:
    """Reuse numbers already on the canvas when the operator asks to reshape it.

    "Add a chart" often repeats the same KPIs that are already on the board.
    Without this, a short follow-up with no digits cannot cite operator-message
    and the model pastes the edit payload into chat after repeated refusals.
    """
    tokens: set[str] = set()
    _collect_figures(body, tokens)
    _merge_operator_figures(ledger, tokens, _result_text(body))


_NUMBER_BLOCK_KINDS = frozenset(
    {"stat", "bar_chart", "pie", "pie_chart", "table", "line_chart", "area_chart"}
)


def keep_editable_blocks(
    blocks: list[Any] | None,
    ledger: dict[str, dict[str, str]] | None,
) -> list[dict[str, Any]]:
    """Drop invented number tiles, or cite operator-message when figures exist.

    Stripping every stat without a cite used to leave a heading-only list;
    ``render_problems`` then refused the board and ``finish_canvas`` failed
    with a red activity chip. Prefer attaching ``operator-message`` when the
    ledger already holds figures from the operator or the current canvas.
    """
    op_entry = ledger.get(OPERATOR_SOURCE_ID) if isinstance(ledger, dict) else None
    op_figures = bool(isinstance(op_entry, dict) and str(op_entry.get("figures") or "").strip())
    kept: list[dict[str, Any]] = []
    for block in blocks if isinstance(blocks, list) else []:
        if not isinstance(block, dict):
            continue
        kind = str(block.get("type") or "")
        if kind in _NUMBER_BLOCK_KINDS:
            source = block.get("source") if isinstance(block.get("source"), dict) else {}
            if not str(source.get("tool_use_id") or "").strip():
                if not op_figures or not isinstance(op_entry, dict):
                    continue
                block = {
                    **block,
                    "source": {
                        "tool": str(op_entry.get("tool") or "operator"),
                        "tool_use_id": OPERATOR_SOURCE_ID,
                        "as_of": str(op_entry.get("as_of") or ""),
                    },
                }
        kept.append(block)
    if kept:
        return kept
    return [
        block
        for block in (blocks if isinstance(blocks, list) else [])
        if isinstance(block, dict) and str(block.get("type") or "") in ("heading", "text")
    ]


def note_turn_tool(
    ledger: dict[str, dict[str, str]],
    tool_id: str,
    name: str,
    *,
    ok: bool,
    result: Any = None,
) -> None:
    """Remember a finished call so a later edit_canvas can cite it.

    ``figures`` is the set of numbers in that result. A later stat may only
    repeat one of those. ``text`` holds its words, so a status tile must
    quote that result too. Both are absent when the caller did not pass a
    result, so older ledgers keep working.
    """
    if not ok or not tool_id or name in _NOT_A_SOURCE:
        return
    from app.core.time import utcnow

    entry: dict[str, str] = {"tool": name, "as_of": utcnow().isoformat(timespec="seconds")}
    if result is not None:
        tokens: set[str] = set()
        _collect_figures(result, tokens)
        entry["figures"] = " ".join(sorted(tokens)[:400])
        entry["text"] = _result_text(result)
    ledger[str(tool_id)] = entry


def tool_result_for_model(name: str, result: Any, tool_use_id: str) -> Any:
    """Put this call's id in the result text the model reads back.

    The id already sits on the tool-result envelope. Models copy fields from
    the result body, and invent one when the body has none. Canvas writes and
    failed calls stay as they are: they are not a source.
    """
    tool_use_id = str(tool_use_id or "").strip()
    if (
        not tool_use_id
        or name in _NOT_A_SOURCE
        or not isinstance(result, dict)
        or result.get("error")
    ):
        return result
    if result.get("tool_use_id") == tool_use_id:
        return result
    return {"tool_use_id": tool_use_id, **result}


def citeable_calls() -> list[tuple[str, str]]:
    """Successful reads in this turn, as (tool name, tool_use_id)."""
    ledger = source_ledger() or {}
    return [
        (str(entry.get("tool") or ""), tool_id)
        for tool_id, entry in ledger.items()
        if tool_id and isinstance(entry, dict) and entry.get("tool")
    ]


def _complete_source(raw: Any) -> dict[str, str] | None:
    if not isinstance(raw, dict):
        return None
    tool = str(raw.get("tool") or "").strip()
    tool_use_id = str(raw.get("tool_use_id") or "").strip()
    as_of = str(raw.get("as_of") or "").strip()
    if not tool or not tool_use_id or not as_of:
        return None
    return {"tool": tool, "tool_use_id": tool_use_id, "as_of": as_of}


def _attach_source(block: dict[str, Any], path: str, errors: list[str]) -> None:
    """Keep a server-stamped source, or require one when this is an agent turn."""
    ledger = source_ledger()
    raw = block.get("source")
    if ledger is None:
        cleaned = _complete_source(raw)
        if cleaned:
            block["source"] = cleaned
        else:
            block.pop("source", None)
        return
    tool_use_id = str(raw.get("tool_use_id") or "").strip() if isinstance(raw, dict) else ""
    claimed = str(raw.get("tool") or "").strip() if isinstance(raw, dict) else ""
    entry = ledger.get(tool_use_id) if tool_use_id else None
    if entry is None:
        errors.append(f"{path}.source: cite tool_use_id from a tool call in this turn")
        block.pop("source", None)
        return
    # The server stamps the tool name. A wrong label on operator-message
    # (a person name, "dit bericht") must not reject numbers they already wrote.
    if claimed and claimed != entry["tool"] and tool_use_id != OPERATOR_SOURCE_ID:
        errors.append(
            f"{path}.source: tool does not match that call. That id is {entry['tool']}"
            + (f", not {claimed}." if claimed else ".")
            + " Do not invent a tool name. If the figures are not in that result, drop the block."
        )
        block.pop("source", None)
        return
    missing = _figures_missing(block, entry.get("figures"), entry.get("text"))
    if missing:
        shown = ", ".join(missing[:4])
        errors.append(
            f"{path}: {shown} is not in the {entry['tool']} result. "
            "Do not invent figures or statuses. Copy only values from that result, "
            "or drop this block and answer in chat."
        )
        block.pop("source", None)
        return
    block["source"] = {
        "tool": entry["tool"],
        "tool_use_id": tool_use_id,
        "as_of": entry["as_of"],
    }


_FIGURE_TEXT = re.compile(r"^[+-]?(?:\d{1,3}(?:[.\s]\d{3})+|\d+)(?:[.,]\d+)?%?$")
# "EUR 120.000", "€120.000,-", "120.000 euro": the amount is the figure.
_CURRENCY = re.compile(r"(?i)^(?:eur|euro|usd|gbp|[€$£])\.?\s*|\s*(?:eur|euro's|euros?|usd|gbp|[€$£])$")
_TEXT_CAP = 20000
# A number inside a sentence, not a whole-string figure.
_FIGURE_IN_TEXT = re.compile(r"(?<![\w])[+-]?(?:\d{1,3}(?:[.\u00a0\s]\d{3})+|\d+)(?:[.,]\d+)?%?(?![\w])")


def _canon_figure(raw: Any) -> str:
    """One comparable token. ``52.000`` and ``52000`` become the same token."""
    if isinstance(raw, bool) or raw is None:
        return ""
    if isinstance(raw, float):
        if raw != raw:  # NaN
            return ""
        if raw.is_integer():
            return str(int(raw))
        return f"{raw:.6f}".rstrip("0").rstrip(".")
    if isinstance(raw, int):
        return str(raw)
    text = _CURRENCY.sub("", str(raw).strip().replace("\u00a0", " ")).strip()
    text = re.sub(r"[.,]-$", "", text.replace(" ", ""))
    if not re.search(r"\d", text):
        return ""
    if text.endswith("%"):
        text = text[:-1]
    if re.fullmatch(r"[+-]?\d{1,3}(?:\.\d{3})+,\d+", text):
        text = text.replace(".", "")
    if re.fullmatch(r"[+-]?\d{1,3}(?:\.\d{3})+", text):
        return text.replace(".", "").lstrip("+")
    if re.fullmatch(r"[+-]?\d{1,3}(?:,\d{3})+", text):
        return text.replace(",", "").lstrip("+")
    text = text.replace(",", ".").lstrip("+")
    try:
        num = float(text)
    except ValueError:
        return ""
    if num.is_integer():
        return str(int(num))
    return f"{num:.6f}".rstrip("0").rstrip(".")


def _collect_figures(value: Any, into: set[str], depth: int = 0) -> None:
    if depth > 6 or len(into) > 500:
        return
    if isinstance(value, bool) or value is None:
        return
    if isinstance(value, (int, float)):
        token = _canon_figure(value)
        if token:
            into.add(token)
        return
    if isinstance(value, str):
        if _FIGURE_TEXT.match(_CURRENCY.sub("", value.strip()).strip()):
            token = _canon_figure(value)
            if token:
                into.add(token)
        return
    if isinstance(value, dict):
        for item in value.values():
            _collect_figures(item, into, depth + 1)
        return
    if isinstance(value, list):
        for item in value[:200]:
            _collect_figures(item, into, depth + 1)


def _block_figures(block: dict[str, Any]) -> list[str]:
    found: list[str] = []

    def add(raw: Any) -> None:
        token = _canon_figure(raw)
        if token:
            found.append(token)

    if "value" in block:
        add(block.get("value"))
    for row in block.get("series") or []:
        if isinstance(row, dict):
            for item in row.get("values") or []:
                add(item)
    for row in block.get("slices") or []:
        if isinstance(row, dict):
            add(row.get("value"))
    for row in block.get("rows") or []:
        cells = row if isinstance(row, list) else [row.get("value")] if isinstance(row, dict) else []
        for cell in cells:
            add(cell)
    return found


def _figures_missing(
    block: dict[str, Any], figures: str | None, text: str | None = None
) -> list[str]:
    """Values on this block that the cited result does not contain.

    ``None`` means the ledger has no figure list (a caller that did not pass
    the result). An empty string means the result had no numbers. A stat
    whose value is words ("Volledig klaar") must appear in the result text.
    """
    if figures is None:
        return []
    have = set(figures.split())
    missing: list[str] = []
    for token in _block_figures(block):
        if token not in have and token not in missing:
            missing.append(token)
    value = block.get("value") if block.get("type") == "stat" else None
    if isinstance(value, str) and value.strip() and not _canon_figure(value):
        if re.search(r"\d", value):
            for match in _FIGURE_IN_TEXT.finditer(value):
                token = _canon_figure(match.group(0))
                if token and token not in have and token not in missing:
                    missing.append(token)
        elif text is not None and _norm_text(value).strip(" .!?:;'\"“”‘’") not in text:
            missing.append(value.strip())
    return missing


def _norm_text(raw: Any) -> str:
    return " ".join(str(raw or "").casefold().split())


def _result_text(value: Any) -> str:
    """The words of a tool result, lowercased, to check a status tile against."""
    parts: list[str] = []

    def walk(item: Any, depth: int) -> None:
        if depth > 6 or len(parts) > 2000:
            return
        if isinstance(item, bool) or item is None:
            return
        if isinstance(item, (str, int, float)):
            parts.append(str(item))
        elif isinstance(item, dict):
            for inner in item.values():
                walk(inner, depth + 1)
        elif isinstance(item, list):
            for inner in item[:200]:
                walk(inner, depth + 1)

    walk(value, 0)
    return _norm_text(" | ".join(parts))[:_TEXT_CAP]


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        text = value.strip().replace(" ", "").replace(",", ".")
        if not text:
            return None
        try:
            return float(text)
        except ValueError:
            return None
    return None


def _canon_type(raw: Any) -> str:
    text = str(raw or "").strip()
    snake = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", text)
    snake = re.sub(r"[\s\-]+", "_", snake).lower()
    return _TYPE_ALIASES.get(snake, snake)


def _as_list(raw: Any) -> tuple[list[Any] | None, str | None]:
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return None, "blocks: expected a list of blocks"
        try:
            raw = json.loads(text)
        except json.JSONDecodeError:
            return None, "blocks: expected a list of blocks, not text"
    if isinstance(raw, dict) and isinstance(raw.get("blocks"), list):
        raw = raw["blocks"]
    if not isinstance(raw, list):
        return None, "blocks: expected a list of blocks"
    return raw, None


def _alias_name(row: dict[str, Any]) -> dict[str, Any]:
    if not row.get("name") and row.get("label"):
        row["name"] = row["label"]
    return row


def _points_to_values(points: Any) -> list[Any]:
    values: list[Any] = []
    if not isinstance(points, list):
        return values
    for point in points:
        if isinstance(point, dict):
            values.append(point.get("y", point.get("value")))
        else:
            values.append(point)
    return values


def _lift_nested_source(block: dict[str, Any]) -> None:
    """A source object parked inside series or slices belongs on the block.

    Models copy the chart example and then tuck the citation into the series
    list. A row that only carries source is not a data series.
    """
    if isinstance(block.get("source"), dict) and str(
        block["source"].get("tool_use_id") or ""
    ).strip():
        return
    for key in ("series", "slices", "data"):
        rows = block.get(key)
        if not isinstance(rows, list):
            continue
        kept: list[Any] = []
        found: dict[str, Any] | None = None
        for row in rows:
            nested = row.get("source") if isinstance(row, dict) else None
            if (
                found is None
                and isinstance(nested, dict)
                and str(nested.get("tool_use_id") or "").strip()
            ):
                found = nested
                rest = {name: value for name, value in row.items() if name != "source"}
                if rest and any(field in rest for field in ("values", "value", "name", "points", "label")):
                    kept.append(rest)
                continue
            kept.append(row)
        if found is not None:
            block["source"] = found
            block[key] = kept
            return


def _lift_chart(item: dict[str, Any]) -> dict[str, Any]:
    """Accept data rows or series.points, then store labels + series.values."""
    series = item.get("series")
    if isinstance(series, list) and series and isinstance(series[0], dict) and (
        "points" in series[0] or "values" in series[0] or "name" in series[0] or "label" in series[0]
    ):
        lifted: list[dict[str, Any]] = []
        labels = [str(label) for label in item.get("labels") or []]
        for row in series:
            if not isinstance(row, dict):
                continue
            row = _alias_name(dict(row))
            if "values" not in row and isinstance(row.get("points"), list):
                points = row["points"]
                if not labels and points and isinstance(points[0], dict):
                    labels = [
                        str(point.get("x") or point.get("label") or "")
                        for point in points
                        if isinstance(point, dict)
                    ]
                row["values"] = _points_to_values(points)
            lifted.append(row)
        if labels:
            item["labels"] = labels
        if lifted:
            item["series"] = lifted
        return item
    data = item.get("data")
    if isinstance(data, list) and data and isinstance(data[0], dict):
        labels = []
        values = []
        for row in data:
            if not isinstance(row, dict):
                continue
            labels.append(str(row.get("x") or row.get("label") or row.get("name") or row.get("month") or ""))
            values.append(row.get("y", row.get("value")))
        item["labels"] = labels
        item["series"] = [{"name": str(item.get("name") or item.get("series_name") or "Value"), "values": values}]
    return item


def _lift_pie(item: dict[str, Any]) -> dict[str, Any]:
    raw = item.get("slices")
    if not isinstance(raw, list):
        raw = item.get("data") if isinstance(item.get("data"), list) else item.get("series")
    if not isinstance(raw, list):
        return item
    slices = []
    for row in raw:
        if not isinstance(row, dict):
            continue
        row = _alias_name(dict(row))
        if "value" not in row:
            row["value"] = row.get("y", row.get("percentage"))
        slices.append(row)
    if slices:
        item["slices"] = slices
    return item


_FIELD_ALIASES = {
    "xAxisTitle": "x_label",
    "x_axis_title": "x_label",
    "xLabel": "x_label",
    "xAxisLabel": "x_label",
    "yAxisTitle": "y_label",
    "y_axis_title": "y_label",
    "yLabel": "y_label",
    "yAxisLabel": "y_label",
}


def _flatten(item: dict[str, Any]) -> dict[str, Any]:
    """Accept the tree shape models copy: fields under props, children for blocks."""
    block = dict(item)
    props = block.pop("props", None)
    if isinstance(props, dict):
        for key, value in props.items():
            block.setdefault(key, value)
    children = block.pop("children", None)
    if isinstance(children, list) and "blocks" not in block:
        block["blocks"] = [child for child in children if isinstance(child, dict)]
    for alias, field in _FIELD_ALIASES.items():
        if alias in block and field not in block:
            block[field] = block.pop(alias)
    return block


_TREND_ALIASES = {
    "up": "up",
    "rising": "up",
    "increase": "up",
    "positive": "up",
    "down": "down",
    "falling": "down",
    "decrease": "down",
    "negative": "down",
    "flat": "flat",
    "stable": "flat",
    "neutral": "flat",
}
_STATUS_ALIASES = {
    "good": "good",
    "ok": "good",
    "success": "good",
    "green": "good",
    "on_track": "good",
    "watch": "watch",
    "warning": "watch",
    "warn": "watch",
    "amber": "watch",
    "yellow": "watch",
    "bad": "bad",
    "danger": "bad",
    "error": "bad",
    "red": "bad",
    "off_track": "bad",
}


def _stat_context(block: dict[str, Any], path: str, errors: list[str]) -> dict[str, Any]:
    """Delta, trend, status, target and sparkline: the context a KPI needs."""
    out: dict[str, Any] = {}
    delta = block.get("delta", block.get("change"))
    if isinstance(delta, (int, float)) and not isinstance(delta, bool):
        out["delta"] = f"{delta:+g}"
    elif delta not in (None, ""):
        out["delta"] = str(delta).strip()
    else:
        out["delta"] = None
    trend = _TREND_ALIASES.get(str(block.get("trend") or "").strip().lower())
    if trend is None and out["delta"]:
        sign = out["delta"].lstrip()[:1]
        trend = "up" if sign == "+" else "down" if sign in ("-", "\u2212") else None
    out["trend"] = trend
    status_key = re.sub(r"[\s\-]+", "_", str(block.get("status") or block.get("tone") or "").strip().lower())
    out["status"] = _STATUS_ALIASES.get(status_key)
    target = block.get("target")
    out["target"] = None if target in (None, "") else str(target).strip()
    spark = block.get("spark", block.get("sparkline"))
    if isinstance(spark, list) and spark:
        numbers = [_number(raw) for raw in spark]
        if any(number is None for number in numbers):
            errors.append(f"{path}.spark: use plain numbers")
            out["spark"] = None
        else:
            out["spark"] = numbers
    else:
        out["spark"] = None
    return out


def _prepare_item(item: Any, path: str, *, parent: str | None = None) -> tuple[dict[str, Any] | None, list[str]]:
    errors: list[str] = []
    if not isinstance(item, dict):
        return None, [f"{path}: expected an object with type"]
    block = _flatten(item)
    kind = _canon_type(block.get("type"))
    if kind not in BLOCK_TYPES:
        shown = kind or str(block.get("type") or "").strip() or "(missing)"
        return None, [f"{path}.type {shown!r} is not available; use {_CHART_HINT}"]
    block["type"] = kind
    if kind == "grid" and parent is not None:
        return None, [f"{path}: a grid sits at the top level; put cards or widgets inside it"]
    if kind == "card" and parent == "card":
        return None, [f"{path}: a card holds widgets, not another card"]
    if kind == "heading":
        level = _number(block.get("level"))
        block["level"] = 2 if level is None else min(3, max(1, int(level)))
        block["text"] = str(block.get("text") or block.get("title") or "").strip()
    elif kind == "text":
        block["text"] = str(block.get("text") or "").strip()
    elif kind == "callout":
        block["text"] = str(block.get("text") or "").strip()
        tone = str(block.get("tone") or "info").strip().lower()
        block["tone"] = tone if tone in _CALLOUT_TONES else "info"
    elif kind == "stat":
        block["label"] = str(block.get("label") or block.get("title") or block.get("name") or "").strip()
        value = block.get("value")
        block["value"] = "" if value is None else str(value).strip()
        block.update(_stat_context(block, path, errors))
    elif kind in _XY_CHARTS:
        _lift_nested_source(block)
        block["title"] = str(block.get("title") or "").strip()
        block["stacked"] = bool(block.get("stacked") or block.get("stack"))
        block["wide"] = bool(block.get("wide") or block.get("full_width"))
        block = _lift_chart(block)
        labels = [str(label) for label in (block.get("labels") or [])]
        block["labels"] = labels
        series = []
        for index, row in enumerate(block.get("series") or []):
            if not isinstance(row, dict):
                errors.append(f"{path}.series[{index}]: expected {{name, values}}")
                continue
            row = _alias_name(dict(row))
            values = []
            for raw in row.get("values") or []:
                number = _number(raw)
                if number is None:
                    errors.append(f"{path}.series[{index}].values: {raw!r} is not a number")
                else:
                    values.append(number)
            if labels and values and len(values) != len(labels):
                errors.append(
                    f"{path}.series[{index}].values: {len(values)} values for {len(labels)} labels"
                )
            series.append({"name": str(row.get("name") or "").strip() or "Value", "values": values})
        block["series"] = series
    elif kind == "pie_chart":
        _lift_nested_source(block)
        block["title"] = str(block.get("title") or "").strip()
        block["wide"] = bool(block.get("wide") or block.get("full_width"))
        block = _lift_pie(block)
        slices = []
        for index, row in enumerate(block.get("slices") or []):
            if not isinstance(row, dict):
                errors.append(f"{path}.slices[{index}]: expected {{name, value}}")
                continue
            row = _alias_name(dict(row))
            number = _number(row.get("value"))
            if number is None:
                errors.append(f"{path}.slices[{index}].value: {row.get('value')!r} is not a number")
                continue
            slices.append({"name": str(row.get("name") or "").strip(), "value": number})
        block["slices"] = slices
    elif kind == "table":
        block["columns"] = [str(col) for col in (block.get("columns") or []) if str(col).strip()]
        rows = []
        for row in block.get("rows") or []:
            if isinstance(row, dict):
                rows.append([row.get(col, "") for col in block["columns"]])
            elif isinstance(row, list):
                rows.append(row)
        block["rows"] = rows
    elif kind == "list":
        block["items"] = [str(entry).strip() for entry in (block.get("items") or []) if str(entry).strip()]
    elif kind == "grid":
        columns = _number(block.get("columns"))
        block["columns"] = 2 if columns is None else min(4, max(1, int(columns)))
    elif kind == "card":
        block["title"] = str(block.get("title") or "").strip()
    if kind in _CONTAINERS:
        children = block.get("blocks")
        if not isinstance(children, list) or not children:
            errors.append(f"{path}.blocks: expected a list of blocks")
            block["blocks"] = []
        else:
            prepared = []
            for index, child in enumerate(children):
                child_block, child_errors = _prepare_item(child, f"{path}.blocks[{index}]", parent=kind)
                errors.extend(child_errors)
                if child_block is not None:
                    prepared.append(child_block)
            block["blocks"] = prepared
    if kind in _NUMBER_BLOCKS:
        _attach_source(block, path, errors)
    return block, errors


def _pydantic_errors(block: dict[str, Any], path: str, *, leaf: bool) -> list[str]:
    adapter = _LEAF_ADAPTER if leaf else _ANY_ADAPTER
    try:
        adapter.validate_python(block)
    except ValidationError as exc:
        messages = []
        for err in exc.errors():
            parts: list[str] = []
            for part in err.get("loc") or []:
                if isinstance(part, int):
                    if parts:
                        parts[-1] = f"{parts[-1]}[{part}]"
                    continue
                # The discriminator tag repeats the block type; it is not a field.
                if part in BLOCK_TYPES:
                    continue
                parts.append(str(part))
            loc = ".".join(parts)
            where = f"{path}.{loc}" if loc else path
            messages.append(f"{where}: {err.get('msg')}")
        return messages
    return []


_MAX_ERRORS = 6


def validate_blocks(raw: Any) -> tuple[list[dict[str, Any]], list[str]]:
    """Return cleaned blocks and path-specific errors. Blocks stay unchanged on error."""
    items, error = _as_list(raw)
    if error or items is None:
        return [], [error or "blocks: expected a list of blocks"]
    if not items:
        return [], ["blocks: pass at least one block"]
    cleaned: list[dict[str, Any]] = []
    errors: list[str] = []
    for index, item in enumerate(items):
        path = f"blocks[{index}]"
        block, prep_errors = _prepare_item(item, path)
        errors.extend(prep_errors)
        if block is None:
            continue
        if not prep_errors:
            errors.extend(_pydantic_errors(block, path, leaf=block.get("type") not in _CONTAINERS))
        cleaned.append(block)
    if errors:
        unique = list(dict.fromkeys(errors))
        if len(unique) > _MAX_ERRORS:
            unique = unique[:_MAX_ERRORS] + [f"... and {len(unique) - _MAX_ERRORS} more"]
        return [], unique
    return cleaned, []


def render_problems(blocks: list[dict[str, Any]] | list[Any]) -> list[str]:
    """Blocks that would draw nothing: no data, all zeros, or an empty table."""
    problems: list[str] = []

    def walk(items: list[Any], path: str) -> None:
        for index, block in enumerate(items or []):
            if not isinstance(block, dict):
                continue
            here = f"{path}[{index}]"
            kind = block.get("type")
            if kind in _XY_CHARTS:
                series = block.get("series") or []
                values = [
                    value
                    for row in series
                    if isinstance(row, dict)
                    for value in (row.get("values") or [])
                ]
                if not block.get("labels") or not values:
                    problems.append(f"{here}: chart has no data")
                elif all(float(value) == 0 for value in values):
                    problems.append(f"{here}: chart values are all zero")
            elif kind == "pie_chart":
                slices = [
                    row
                    for row in (block.get("slices") or [])
                    if isinstance(row, dict) and float(row.get("value") or 0) > 0 and row.get("name")
                ]
                if not slices:
                    problems.append(f"{here}: pie chart has no slices")
            elif kind == "table" and (not block.get("columns") or not block.get("rows")):
                problems.append(f"{here}: table is empty")
            elif kind in _CONTAINERS:
                walk(block.get("blocks") or [], f"{here}.blocks")

    walk(list(blocks or []), "blocks")
    if blocks and not _has_number_block(list(blocks)):
        problems.append(NO_FIGURES_PROBLEM)
    return problems


NO_FIGURES_PROBLEM = (
    "A dashboard needs at least one stat, chart or table. A heading alone is not a dashboard."
)


def text_only_markdown(blocks: list[Any] | None) -> str:
    """Markdown for blocks that hold only text; "" when any block is not plain text.

    A dashboard request that carries no figures is a document. This keeps the
    words and refuses to guess at anything that is not heading, text, callout,
    list or divider.
    """
    lines: list[str] = []

    def walk(items: list[Any]) -> bool:
        for block in items:
            if not isinstance(block, dict):
                return False
            kind = block.get("type")
            text = str(block.get("text") or "").strip()
            if kind == "heading":
                level = min(3, max(1, int(block.get("level") or 2)))
                lines.append("#" * level + " " + text if text else "")
            elif kind in ("text", "callout"):
                lines.append(text)
            elif kind == "list":
                lines.append("\n".join(f"- {item}" for item in block.get("items") or []))
            elif kind == "divider":
                lines.append("---")
            elif kind in _CONTAINERS:
                title = str(block.get("title") or "").strip()
                if title:
                    lines.append(f"### {title}")
                if not walk(block.get("blocks") or []):
                    return False
            else:
                return False
        return True

    if not blocks or not walk(list(blocks)):
        return ""
    return "\n\n".join(line for line in lines if line.strip()).strip()


def _has_number_block(items: list[Any]) -> bool:
    for block in items or []:
        if not isinstance(block, dict):
            continue
        if block.get("type") in _NUMBER_BLOCKS:
            return True
        if block.get("type") in _CONTAINERS and _has_number_block(block.get("blocks") or []):
            return True
    return False


_MAX_PIE_SLICES = 6
_MAX_HEADLINE_STATS = 6
_MAX_CHART_LABELS = 24


def _pie_as_bar(block: dict[str, Any]) -> dict[str, Any]:
    slices = sorted(block.get("slices") or [], key=lambda row: float(row.get("value") or 0), reverse=True)
    return {
        "type": "bar_chart",
        "title": block.get("title") or "",
        "labels": [str(row.get("name") or "") for row in slices],
        "series": [{"name": "Value", "values": [float(row.get("value") or 0) for row in slices]}],
        "stacked": False,
        "wide": bool(block.get("wide")),
        **({"source": block["source"]} if _complete_source(block.get("source")) else {}),
    }


def polish_blocks(blocks: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[str]]:
    """Safe automatic fixes plus design notes. Notes never block a save."""
    notes: list[str] = []
    polished: list[dict[str, Any]] = []
    for block in blocks:
        if block.get("type") == "pie_chart" and len(block.get("slices") or []) > _MAX_PIE_SLICES:
            polished.append(_pie_as_bar(block))
            notes.append(
                f"A pie with more than {_MAX_PIE_SLICES} slices is hard to read; it is now a sorted bar_chart."
            )
            continue
        polished.append(block)

    def flat(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for item in items:
            out.append(item)
            if item.get("type") in _CONTAINERS:
                out.extend(flat(item.get("blocks") or []))
        return out

    every = flat(polished)
    stats = [block for block in every if block.get("type") == "stat"]
    if polished and polished[0].get("type") != "heading":
        notes.append("Open with a heading that states the main finding, e.g. 'Omzet 12% boven plan'.")
    if len(stats) > _MAX_HEADLINE_STATS:
        notes.append(
            f"{len(stats)} stats: keep 3-{_MAX_HEADLINE_STATS} headline numbers and move the rest into a table."
        )
    if len(stats) >= 2 and not any(
        stat.get("delta") or stat.get("target") or stat.get("hint") or stat.get("spark") for stat in stats
    ):
        notes.append("Stats have no context; add delta, target, or hint where the data has it.")
    for block in every:
        labels = block.get("labels") or []
        if block.get("type") in _XY_CHARTS and len(labels) > _MAX_CHART_LABELS:
            notes.append(
                f"'{block.get('title') or block['type']}' has {len(labels)} labels; group them or show the top 10 plus a table."
            )
    return polished, notes


def _chart_node(block: dict[str, Any], node_type: str) -> dict[str, Any]:
    labels = [str(label) for label in block.get("labels") or []]
    series = []
    for row in block.get("series") or []:
        values = row.get("values") or []
        series.append(
            {
                "name": row.get("name") or "Value",
                "points": [
                    {"x": labels[i], "y": float(values[i])}
                    for i in range(min(len(labels), len(values)))
                ],
            }
        )
    props: dict[str, Any] = {"title": block.get("title") or "", "series": series}
    if block.get("x_label"):
        props["xLabel"] = block["x_label"]
    if block.get("y_label"):
        props["yLabel"] = block["y_label"]
    if block.get("stacked"):
        props["stacked"] = True
    if block.get("wide"):
        props["wide"] = True
    source = _complete_source(block.get("source"))
    if source:
        props["source"] = source
    return {"type": node_type, "props": props, "children": []}


_STAT_EXTRAS = ("unit", "hint", "delta", "trend", "status", "target", "spark")


def _node(block: dict[str, Any]) -> dict[str, Any]:
    kind = block.get("type")
    if kind == "heading":
        return {
            "type": "Heading",
            "props": {"text": block.get("text") or "", "level": int(block.get("level") or 2)},
            "children": [],
        }
    if kind == "text":
        return {"type": "Text", "props": {"text": block.get("text") or ""}, "children": []}
    if kind == "callout":
        return {
            "type": "Callout",
            "props": {"text": block.get("text") or "", "tone": block.get("tone") or "info"},
            "children": [],
        }
    if kind == "stat":
        label = str(block.get("label") or "")
        props = {"title": label, "label": label, "value": str(block.get("value") or "")}
        for key in _STAT_EXTRAS:
            if block.get(key):
                props[key] = block[key]
        source = _complete_source(block.get("source"))
        if source:
            props["source"] = source
        return {"type": "Stat", "props": props, "children": []}
    if kind in _XY_CHARTS:
        return _chart_node(block, _XY_NODE[kind])
    if kind == "pie_chart":
        props = {
            "title": block.get("title") or "",
            "slices": [
                {"name": row.get("name") or "", "value": float(row.get("value") or 0)}
                for row in block.get("slices") or []
                if isinstance(row, dict)
            ],
        }
        if block.get("wide"):
            props["wide"] = True
        source = _complete_source(block.get("source"))
        if source:
            props["source"] = source
        return {"type": "PieChart", "props": props, "children": []}
    if kind == "table":
        props = {
            "title": block.get("title") or "",
            "columns": [str(col) for col in block.get("columns") or []],
            "rows": [
                ["" if cell is None else str(cell) for cell in row]
                for row in block.get("rows") or []
                if isinstance(row, list)
            ],
        }
        source = _complete_source(block.get("source"))
        if source:
            props["source"] = source
        return {"type": "Table", "props": props, "children": []}
    if kind == "list":
        return {"type": "List", "props": {"items": list(block.get("items") or [])}, "children": []}
    if kind == "divider":
        return {"type": "Divider", "props": {}, "children": []}
    if kind == "grid":
        return {
            "type": "Grid",
            "props": {"columns": int(block.get("columns") or 2)},
            "children": [_node(child) for child in block.get("blocks") or [] if isinstance(child, dict)],
        }
    if kind == "card":
        return {
            "type": "Card",
            "props": {"title": block.get("title") or ""},
            "children": [_node(child) for child in block.get("blocks") or [] if isinstance(child, dict)],
        }
    return {"type": "Text", "props": {"text": ""}, "children": []}


_XY_NODE = {"bar_chart": "BarChart", "line_chart": "LineChart", "area_chart": "AreaChart"}
_NODE_XY = {node: kind for kind, node in _XY_NODE.items()}


def _chart_card(block: dict[str, Any]) -> dict[str, Any]:
    """A chart in its own panel. The card carries the title; ``auto`` marks layout."""
    inner = _node({**block, "title": ""})
    return {
        "type": "Card",
        "props": {"title": block.get("title") or "", "auto": True},
        "children": [inner],
    }


def _auto_grid(columns: int, children: list[dict[str, Any]]) -> dict[str, Any]:
    return {"type": "Grid", "props": {"columns": columns, "auto": True}, "children": children}


def _layout(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The server owns layout: the model writes an ordered list, never column math.

    Consecutive stats form one KPI row. Consecutive charts share two columns;
    with an odd count the first one is the full-width hero. A chart with
    ``wide`` always takes the full row.
    """
    out: list[dict[str, Any]] = []
    index = 0
    items = [block for block in blocks if isinstance(block, dict)]
    while index < len(items):
        block = items[index]
        kind = block.get("type")
        if kind == "stat":
            run = []
            while index < len(items) and items[index].get("type") == "stat":
                run.append(items[index])
                index += 1
            tiles = [_node(stat) for stat in run]
            for tile in tiles:
                tile["props"]["tile"] = True
            out.append(_auto_grid(min(4, len(tiles)), tiles))
            continue
        if kind in _CHARTS and not block.get("wide"):
            run = []
            while (
                index < len(items)
                and items[index].get("type") in _CHARTS
                and not items[index].get("wide")
            ):
                run.append(items[index])
                index += 1
            if len(run) % 2 == 1:
                out.append(_chart_card(run[0]))
                run = run[1:]
            for start in range(0, len(run), 2):
                out.append(_auto_grid(2, [_chart_card(chart) for chart in run[start : start + 2]]))
            continue
        out.append(_chart_card(block) if kind in _CHARTS else _node(block))
        index += 1
    return out


def blocks_to_tree(blocks: list[dict[str, Any]]) -> dict[str, Any]:
    return {"type": "Stack", "props": {}, "children": _layout(list(blocks or []))}


def _chart_block(node_type: str, props: dict[str, Any]) -> dict[str, Any] | None:
    labels: list[str] = []
    series: list[dict[str, Any]] = []
    for row in props.get("series") or []:
        if not isinstance(row, dict):
            continue
        points = row.get("points") or []
        if not labels:
            labels = [str(point.get("x") or "") for point in points if isinstance(point, dict)]
        series.append(
            {
                "name": str(row.get("name") or "Value"),
                "values": [
                    float(point.get("y") or 0)
                    for point in points
                    if isinstance(point, dict)
                ],
            }
        )
    if not labels or not series:
        return None
    block: dict[str, Any] = {
        "type": _NODE_XY.get(node_type, "line_chart"),
        "title": str(props.get("title") or ""),
        "labels": labels,
        "series": series,
    }
    if props.get("xLabel") or props.get("x_label"):
        block["x_label"] = str(props.get("xLabel") or props.get("x_label"))
    if props.get("yLabel") or props.get("y_label"):
        block["y_label"] = str(props.get("yLabel") or props.get("y_label"))
    for key in ("stacked", "wide"):
        if props.get(key):
            block[key] = True
    source = _complete_source(props.get("source"))
    if source:
        block["source"] = source
    return block


def _node_to_block(node: Any, *, parent: str | None = None) -> dict[str, Any] | None:
    if not isinstance(node, dict):
        return None
    kind = _NODE_TO_BLOCK.get(str(node.get("type") or ""))
    props = node.get("props") if isinstance(node.get("props"), dict) else {}
    children = [child for child in (node.get("children") or []) if isinstance(child, dict)]
    if kind is None:
        return None
    if kind == "heading":
        text = str(props.get("text") or "").strip()
        return {"type": "heading", "text": text or "Heading", "level": int(props.get("level") or 2)} if text or not children else None
    if kind == "text":
        text = str(props.get("text") or props.get("label") or "").strip()
        return {"type": "text", "text": text} if text else None
    if kind == "callout":
        text = str(props.get("text") or "").strip()
        return {"type": "callout", "text": text, "tone": props.get("tone") or "info"} if text else None
    if kind == "stat":
        label = str(props.get("label") or props.get("title") or "").strip()
        value = str(props.get("value") or "").strip()
        if not label or not value:
            return None
        block: dict[str, Any] = {"type": "stat", "label": label, "value": value}
        for key in _STAT_EXTRAS:
            if props.get(key):
                block[key] = props[key] if key == "spark" else str(props[key])
        source = _complete_source(props.get("source"))
        if source:
            block["source"] = source
        return block
    if kind in _XY_CHARTS:
        return _chart_block(_XY_NODE[kind], props)
    if kind == "pie_chart":
        slices = []
        for row in props.get("slices") or props.get("series") or []:
            if isinstance(row, dict) and row.get("name"):
                slices.append({"name": str(row.get("name")), "value": float(row.get("value") or 0)})
        if not slices:
            return None
        pie: dict[str, Any] = {"type": "pie_chart", "title": str(props.get("title") or ""), "slices": slices}
        if props.get("wide"):
            pie["wide"] = True
        source = _complete_source(props.get("source"))
        if source:
            pie["source"] = source
        return pie
    if kind == "table":
        columns = [str(col) for col in props.get("columns") or []]
        rows = props.get("rows") or []
        if not columns or not rows:
            return None
        table: dict[str, Any] = {
            "type": "table",
            "title": str(props.get("title") or "") or None,
            "columns": columns,
            "rows": rows,
        }
        source = _complete_source(props.get("source"))
        if source:
            table["source"] = source
        return table
    if kind == "list":
        items = [str(item) for item in props.get("items") or [] if str(item).strip()]
        return {"type": "list", "items": items} if items else None
    if kind == "divider":
        return {"type": "divider"}
    allowed = (kind == "grid" and parent is None) or (kind == "card" and parent != "card")
    if kind in _CONTAINERS and allowed and children:
        inner = [block for child in children if (block := _node_to_block(child, parent=kind))]
        if not inner:
            return None
        if kind == "grid":
            return {"type": "grid", "columns": int(props.get("columns") or 2), "blocks": inner}
        title = str(props.get("title") or "").strip() or "Card"
        return {"type": "card", "title": title, "blocks": inner}
    return None


def tree_to_blocks(tree: Any) -> list[dict[str, Any]]:
    """Best-effort read of a stored tree. Empty charts are left out."""
    if isinstance(tree, str):
        try:
            tree = json.loads(tree)
        except json.JSONDecodeError:
            return []
    if not isinstance(tree, dict):
        return []
    nodes = (tree.get("children") or []) if tree.get("type") == "Stack" else [tree]
    return [block for node in _unwrap_auto(nodes) if (block := _node_to_block(node))]


def _unwrap_auto(nodes: list[Any]) -> list[dict[str, Any]]:
    """Undo ``_layout``: auto grids flatten, an auto card gives its title to the chart."""
    flat: list[dict[str, Any]] = []
    for node in nodes:
        if not isinstance(node, dict):
            continue
        props = node.get("props") if isinstance(node.get("props"), dict) else {}
        children = [child for child in (node.get("children") or []) if isinstance(child, dict)]
        if not props.get("auto"):
            flat.append(node)
            continue
        if node.get("type") == "Grid":
            flat.extend(_unwrap_auto(children))
            continue
        if node.get("type") == "Card" and len(children) == 1:
            chart = dict(children[0])
            chart_props = dict(chart.get("props") or {})
            chart_props["title"] = props.get("title") or chart_props.get("title") or ""
            chart["props"] = chart_props
            flat.append(chart)
            continue
        flat.append(node)
    return flat
