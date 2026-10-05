"""Compile a restricted bokito/canvas document to a JSON tree.

Agents write a JSX subset. The dashboard never evals the source: only the
validated tree is rendered.
"""

from __future__ import annotations

import json
import re
from typing import Any

SDK_TYPES = frozenset(
    {
        "Stack",
        "Grid",
        "Row",
        "Text",
        "Heading",
        "Callout",
        "Divider",
        "List",
        "Stat",
        "Table",
        "BarChart",
        "LineChart",
        "Card",
        "Badge",
    }
)

EMPTY_TREE: dict[str, Any] = {"type": "Stack", "props": {}, "children": []}
EMPTY_SOURCE = (
    'import { Stack } from "bokito/canvas"\n\n'
    "export default function Canvas() {\n"
    "  return <Stack />\n"
    "}\n"
)

_MAX_SOURCE = 80_000
_MAX_NODES = 200
_MAX_DEPTH = 12
_MAX_STRING = 8_000

_FORBIDDEN = re.compile(
    r"\b(fetch|eval|require|process|window|document|localStorage)\b"
    r"|<script\b"
    r"|javascript:"
    r"|import\s*\(",
    re.IGNORECASE,
)
_FORBIDDEN_FUNCTION = re.compile(r"\bFunction\b")
_FORBIDDEN_HANDLERS = re.compile(r"\bon[A-Z][A-Za-z]+\s*=")
_IMPORT_RE = re.compile(
    r"""import\s+(?:\{[^}]*\}|[\w*]+(?:\s+as\s+\w+)?)\s+from\s+['"]([^'"]+)['"]"""
)


class CanvasCompileError(ValueError):
    """Raised when source or tree is not a valid canvas document."""


def compile_canvas(*, source: str | None = None, tree: Any = None) -> tuple[str, dict[str, Any]]:
    """Return (source, tree). Provide source and/or tree."""
    if source is not None and str(source).strip():
        parsed = parse_source(str(source))
        return tree_to_source(parsed), parsed
    if tree is not None:
        validated = normalize_tree(tree)
        return tree_to_source(validated), validated
    return EMPTY_SOURCE, dict(EMPTY_TREE)


def is_empty_tree(tree: Any) -> bool:
    node = tree if isinstance(tree, dict) else {}
    children = node.get("children")
    props = node.get("props") if isinstance(node.get("props"), dict) else {}
    return (
        str(node.get("type") or "Stack") == "Stack"
        and not props
        and (not isinstance(children, list) or len(children) == 0)
    )


def parse_source(source: str) -> dict[str, Any]:
    raw = source.replace("\r\n", "\n")
    if len(raw) > _MAX_SOURCE:
        raise CanvasCompileError("Canvas source is too large.")
    if (
        _FORBIDDEN.search(raw)
        or _FORBIDDEN_FUNCTION.search(raw)
        or _FORBIDDEN_HANDLERS.search(raw)
    ):
        raise CanvasCompileError(
            "Canvas source may not use fetch, eval, imports other than bokito/canvas, or event handlers."
        )
    for match in _IMPORT_RE.finditer(raw):
        spec = match.group(1).strip()
        if spec not in {"bokito/canvas", "bokito/canvas.js"}:
            raise CanvasCompileError(f"Only import from bokito/canvas is allowed (got {spec!r}).")
    jsx = _extract_jsx(raw)
    parser = _JsxParser(jsx)
    node = parser.parse_node()
    parser.skip_ws()
    if parser.i < len(parser.s) and parser.s[parser.i] not in ");}":
        # trailing junk after root is ok if it's closing the return/function
        pass
    return normalize_tree(node)


def normalize_tree(raw: Any, *, depth: int = 0, counter: list[int] | None = None) -> dict[str, Any]:
    if counter is None:
        counter = [0]
    if depth > _MAX_DEPTH:
        raise CanvasCompileError("Canvas tree is too deep.")
    if not isinstance(raw, dict):
        raise CanvasCompileError("Each canvas node must be an object with type.")
    node_type = str(raw.get("type") or "").strip()
    if node_type not in SDK_TYPES:
        raise CanvasCompileError(f"Unknown canvas component {node_type!r}.")
    counter[0] += 1
    if counter[0] > _MAX_NODES:
        raise CanvasCompileError("Canvas has too many nodes.")
    props = _clean_props(raw.get("props") if isinstance(raw.get("props"), dict) else {})
    children_raw = raw.get("children")
    children: list[Any] = []
    if isinstance(children_raw, list):
        for child in children_raw:
            if isinstance(child, str):
                text = child.strip()
                if text:
                    children.append({"type": "Text", "props": {"text": text[:_MAX_STRING]}, "children": []})
            elif isinstance(child, dict):
                children.append(normalize_tree(child, depth=depth + 1, counter=counter))
    return {"type": node_type, "props": props, "children": children}


def tree_to_source(tree: dict[str, Any]) -> str:
    used: set[str] = set()
    body = _emit_jsx(tree, indent=2, used=used)
    names = ", ".join(sorted(used) or ["Stack"])
    return (
        f'import {{ {names} }} from "bokito/canvas"\n\n'
        "export default function Canvas() {\n"
        f"  return (\n{body}\n"
        "  )\n"
        "}\n"
    )


def _extract_jsx(source: str) -> str:
    stripped = re.sub(r"/\*.*?\*/", "", source, flags=re.DOTALL)
    stripped = re.sub(r"//.*?$", "", stripped, flags=re.MULTILINE)
    return_m = re.search(r"return\s*\(", stripped)
    if return_m:
        start = stripped.find("<", return_m.end() - 1)
        if start < 0:
            start = stripped.find("<", return_m.end())
        if start >= 0:
            return stripped[start:]
    first = stripped.find("<")
    if first < 0:
        raise CanvasCompileError("Canvas source must contain a JSX root element.")
    return stripped[first:]


def _clean_props(props: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in list(props.items())[:40]:
        name = str(key).strip()
        if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", name):
            continue
        if name.lower().startswith("on"):
            continue
        cleaned = _clean_value(value, depth=0)
        if cleaned is not None:
            out[name] = cleaned
    return out


def _clean_value(value: Any, *, depth: int) -> Any:
    if depth > 6:
        return None
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return value[:_MAX_STRING]
    if isinstance(value, list):
        return [_clean_value(v, depth=depth + 1) for v in value[:80]]
    if isinstance(value, dict):
        return {
            str(k)[:64]: _clean_value(v, depth=depth + 1)
            for k, v in list(value.items())[:40]
        }
    return str(value)[:_MAX_STRING]


class _JsxParser:
    def __init__(self, source: str) -> None:
        self.s = source
        self.i = 0

    def skip_ws(self) -> None:
        while self.i < len(self.s) and self.s[self.i].isspace():
            self.i += 1

    def parse_node(self) -> dict[str, Any]:
        self.skip_ws()
        if self.i >= len(self.s) or self.s[self.i] != "<":
            raise CanvasCompileError("Expected a JSX tag.")
        self.i += 1
        if self.i < len(self.s) and self.s[self.i] == "/":
            raise CanvasCompileError("Unexpected closing tag.")
        name = self._read_ident()
        if name not in SDK_TYPES:
            raise CanvasCompileError(f"Unknown canvas component {name!r}.")
        props = self._read_props()
        self.skip_ws()
        if self.i < len(self.s) - 1 and self.s[self.i : self.i + 2] == "/>":
            self.i += 2
            return {"type": name, "props": props, "children": []}
        if self.i >= len(self.s) or self.s[self.i] != ">":
            raise CanvasCompileError(f"Expected > after <{name}.")
        self.i += 1
        children: list[Any] = []
        while True:
            self.skip_ws()
            if self.i >= len(self.s):
                raise CanvasCompileError(f"Unclosed <{name}>.")
            if self.s.startswith("</", self.i):
                self.i += 2
                close = self._read_ident()
                if close != name:
                    raise CanvasCompileError(f"Mismatched tag: opened {name}, closed {close}.")
                self.skip_ws()
                if self.i >= len(self.s) or self.s[self.i] != ">":
                    raise CanvasCompileError("Expected > on closing tag.")
                self.i += 1
                break
            if self.s[self.i] == "<":
                children.append(self.parse_node())
            else:
                text = self._read_text()
                if text:
                    children.append(text)
        if name in {"Text", "Heading", "Callout", "Badge"} and "text" not in props:
            joined = "".join(c for c in children if isinstance(c, str)).strip()
            if joined:
                props["text"] = joined[:_MAX_STRING]
                children = [c for c in children if not isinstance(c, str)]
        if name == "List" and "items" not in props:
            items = []
            kept: list[Any] = []
            for child in children:
                if isinstance(child, str):
                    items.append(child)
                elif isinstance(child, dict) and child.get("type") == "Text":
                    items.append(str((child.get("props") or {}).get("text") or ""))
                else:
                    kept.append(child)
            if items:
                props["items"] = items
                children = kept
        return {"type": name, "props": props, "children": children}

    def _read_ident(self) -> str:
        self.skip_ws()
        start = self.i
        while self.i < len(self.s) and (self.s[self.i].isalnum() or self.s[self.i] == "_"):
            self.i += 1
        if start == self.i:
            raise CanvasCompileError("Expected a component name.")
        return self.s[start : self.i]

    def _read_props(self) -> dict[str, Any]:
        props: dict[str, Any] = {}
        while True:
            self.skip_ws()
            if self.i >= len(self.s):
                break
            ch = self.s[self.i]
            if ch in ">/":
                break
            key = self._read_ident()
            self.skip_ws()
            if self.i < len(self.s) and self.s[self.i] == "=":
                self.i += 1
                self.skip_ws()
                props[key] = self._read_prop_value()
            else:
                props[key] = True
        return props

    def _read_prop_value(self) -> Any:
        if self.i >= len(self.s):
            raise CanvasCompileError("Expected a prop value.")
        if self.s[self.i] in {'"', "'"}:
            quote = self.s[self.i]
            self.i += 1
            start = self.i
            while self.i < len(self.s) and self.s[self.i] != quote:
                if self.s[self.i] == "\\":
                    self.i += 2
                    continue
                self.i += 1
            value = self.s[start : self.i]
            if self.i < len(self.s):
                self.i += 1
            return value
        if self.s[self.i] != "{":
            raise CanvasCompileError("Prop values must be a string or {expression}.")
        expr = self._read_balanced("{", "}")
        return _parse_js_value(expr)

    def _read_balanced(self, open_ch: str, close_ch: str) -> str:
        if self.s[self.i] != open_ch:
            raise CanvasCompileError(f"Expected {open_ch}.")
        depth = 0
        start = self.i + 1
        in_str: str | None = None
        self.i += 1
        while self.i < len(self.s):
            ch = self.s[self.i]
            if in_str:
                if ch == "\\" and self.i + 1 < len(self.s):
                    self.i += 2
                    continue
                if ch == in_str:
                    in_str = None
                self.i += 1
                continue
            if ch in {'"', "'"}:
                in_str = ch
            elif ch == open_ch:
                depth += 1
            elif ch == close_ch:
                if depth == 0:
                    inner = self.s[start : self.i]
                    self.i += 1
                    return inner.strip()
                depth -= 1
            self.i += 1
        raise CanvasCompileError("Unbalanced braces in JSX prop.")

    def _read_text(self) -> str:
        start = self.i
        while self.i < len(self.s) and self.s[self.i] != "<":
            self.i += 1
        return self.s[start : self.i]


def _parse_js_value(expr: str) -> Any:
    text = expr.strip()
    if not text:
        return None
    if text in {"true", "True"}:
        return True
    if text in {"false", "False"}:
        return False
    if text in {"null", "undefined", "None"}:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # JS object / array with unquoted keys.
    normalized = _js_to_json(text)
    try:
        return json.loads(normalized)
    except json.JSONDecodeError as exc:
        raise CanvasCompileError(f"Could not parse prop value: {text[:80]}") from exc


def _js_to_json(text: str) -> str:
    out: list[str] = []
    i = 0
    in_str: str | None = None
    while i < len(text):
        ch = text[i]
        if in_str:
            out.append(ch)
            if ch == "\\" and i + 1 < len(text):
                out.append(text[i + 1])
                i += 2
                continue
            if ch == in_str:
                in_str = None
            i += 1
            continue
        if ch in {'"', "'"}:
            in_str = ch
            out.append('"')
            i += 1
            continue
        if ch.isalpha() or ch == "_":
            start = i
            while i < len(text) and (text[i].isalnum() or text[i] == "_"):
                i += 1
            ident = text[start:i]
            nxt = text[i:].lstrip()[:1]
            prev = "".join(out).rstrip()[-1:] if out else ""
            if ident in {"true", "false", "null"}:
                out.append(ident)
            elif nxt == ":" and prev in "{,":
                out.append(json.dumps(ident))
            else:
                raise CanvasCompileError(f"Unsupported expression {ident!r} in canvas props.")
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def _emit_jsx(node: dict[str, Any], *, indent: int, used: set[str]) -> str:
    node_type = str(node.get("type") or "Stack")
    used.add(node_type)
    props = node.get("props") if isinstance(node.get("props"), dict) else {}
    children = node.get("children") if isinstance(node.get("children"), list) else []
    pad = " " * indent
    attr = "".join(_emit_attr(k, v) for k, v in props.items())
    if not children:
        return f"{pad}<{node_type}{attr} />"
    inner: list[str] = []
    for child in children:
        if isinstance(child, dict):
            inner.append(_emit_jsx(child, indent=indent + 2, used=used))
        elif isinstance(child, str) and child.strip():
            inner.append(" " * (indent + 2) + child.strip())
    body = "\n".join(inner)
    return f"{pad}<{node_type}{attr}>\n{body}\n{pad}</{node_type}>"


def _emit_attr(key: str, value: Any) -> str:
    if value is True:
        return f" {key}"
    if isinstance(value, str):
        escaped = value.replace("\\", "\\\\").replace('"', '\\"')
        return f' {key}="{escaped}"'
    return f" {key}={{{json.dumps(value, ensure_ascii=False)}}}"
