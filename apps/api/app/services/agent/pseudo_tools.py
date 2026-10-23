"""Tool calls the model wrote as text. They are never executed.

A line ``create_canvas(`` is speech, not a tool call. Hold it until the
parentheses close, then drop it. The model is nudged once to call the tool.
"""

from __future__ import annotations

import re

_NAME = re.compile(r"\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(")
_BARE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*$")
_FENCE = re.compile(r"^\s*```")
_EMPTY_FENCE = re.compile(r"```[^\n]*\n\s*```")


def names_from_tools(tools: list | None) -> set[str]:
    found: set[str] = set()
    for tool in tools or []:
        if isinstance(tool, dict) and tool.get("name"):
            found.add(str(tool["name"]))
        elif isinstance(tool, str) and tool:
            found.add(tool)
    return found


def _call_name(line: str, names: set[str]) -> str | None:
    match = _NAME.match(line or "")
    if match and match.group(1) in names:
        return match.group(1)
    return None


def _might_hold(line: str, names: set[str]) -> bool:
    """Last partial line may still become ``tool_name(``."""
    stripped = (line or "").strip()
    if not stripped or not _BARE.match(stripped):
        return False
    return any(name.startswith(stripped) for name in names)


def find_pseudo_calls(text: str, tool_names: set[str] | list[str]) -> list[str]:
    """Tool names written as ``name(`` lines, inside or outside a fence."""
    names = set(tool_names)
    found: list[str] = []
    for line in (text or "").splitlines():
        if _FENCE.match(line):
            continue
        name = _call_name(line, names)
        if name and name not in found:
            found.append(name)
    return found


def _join(lines: list[str], *, newline: bool) -> str:
    text = "\n".join(lines)
    if newline and lines:
        text += "\n"
    return text


def release_speech(buf: str, tool_names: set[str] | list[str]) -> tuple[str, str]:
    """Split ``buf`` into text safe to show and a tail still held.

    A closed ``tool_name(...)`` call, and a fence that contains only that
    call, is dropped. An open call stays in the hold.
    """
    names = set(tool_names)
    if not buf or not names:
        return buf or "", ""
    lines = buf.split("\n")
    ends_nl = buf.endswith("\n")
    out: list[str] = []
    index = 0
    while index < len(lines):
        line = lines[index]
        last_partial = index == len(lines) - 1 and not ends_nl
        if _FENCE.match(line):
            # Hold an opening fence until the next line shows whether it is a call.
            if last_partial or index + 1 >= len(lines):
                return _join(out, newline=bool(out)), "\n".join(lines[index:])
            nxt = lines[index + 1]
            if _call_name(nxt, names) or (index + 1 == len(lines) - 1 and not ends_nl and _might_hold(nxt, names)):
                if _might_hold(nxt, names) and not _call_name(nxt, names):
                    return _join(out, newline=bool(out)), "\n".join(lines[index:])
                end, closed = _call_end(lines, index + 1, names)
                if not closed:
                    return _join(out, newline=bool(out)), "\n".join(lines[index:])
                if end < len(lines) and _FENCE.match(lines[end]):
                    end += 1
                index = end
                continue
            out.append(line)
            index += 1
            continue
        if _call_name(line, names):
            end, closed = _call_end(lines, index, names)
            if not closed:
                return _join(out, newline=bool(out)), "\n".join(lines[index:])
            index = end
            continue
        if last_partial and _might_hold(line, names):
            return _join(out, newline=bool(out)), line
        out.append(line)
        index += 1
    return _join(out, newline=ends_nl), ""


def _looks_like_arg(line: str) -> bool:
    stripped = line.strip()
    if not stripped or line[:1].isspace():
        return True
    return stripped[:1] in "\"'[{()}]"


def _call_end(lines: list[str], start: int, names: set[str]) -> tuple[int, bool]:
    depth = lines[start].count("(") - lines[start].count(")")
    index = start + 1
    while depth > 0 and index < len(lines):
        # A new sentence means the call was left open. Keep that sentence.
        if lines[index].strip() and not _looks_like_arg(lines[index]):
            return index, True
        depth += lines[index].count("(") - lines[index].count(")")
        index += 1
    return index, depth <= 0


def strip_pseudo_calls(text: str, tool_names: set[str] | list[str]) -> tuple[str, bool]:
    """Drop pseudo calls from a finished message, including one left unclosed."""
    names = set(tool_names)
    if not text or not names or not find_pseudo_calls(text, names):
        return text or "", False
    shown, held = release_speech(text, names)
    if held and not (_might_hold(held, names) and "(" not in held and "```" not in held):
        held = ""
    cleaned = _EMPTY_FENCE.sub("", shown + held)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    return cleaned, True
