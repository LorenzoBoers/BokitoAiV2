"""What the chat may show for one activity item.

The loop stores tool input and result. The list and the live stream do not.
This module copies the few display fields onto the public item so the client
translates a key or prints a host, and does not read the tool payload.
"""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import urlparse

_HOST_RE = re.compile(r"(?:^|\s)(?:site:)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:/|\s|$)", re.IGNORECASE)
_INVITE_TOOLS = frozenset({"invite_to_thread"})
_PEER_TOOL_KEYS = {"ask_agent": "activity.asking", "handoff_to": "activity.handingOver"}
_WEB_TOOLS = frozenset({"web_search", "fetch_url"})


def activity_label_key(item: dict[str, Any]) -> str | None:
    """Translation key for image generation. Other tools use ``present_activity``."""
    if str(item.get("tool") or "") != "generate_image":
        return None
    if item.get("status") == "error":
        return "activity.imageFailed"
    if item.get("status") == "running":
        return "activity.generatingImage"
    return "activity.generatedImage"


def surface_motion(
    pending: list[dict[str, Any]],
    *,
    speaking: bool,
    worked: bool,
    opening: bool = False,
) -> str:
    """Face motion for the live orb. The client plays this; it does not infer it."""
    if speaking:
        return "typing"
    if any(item.get("proposes") for item in pending):
        return "idle"
    if any(item.get("status") == "running" and item.get("tool") for item in pending):
        return "working"
    if any(item.get("kind") == "think" and item.get("status") == "running" for item in pending):
        return "thinking"
    if worked:
        return "working"
    if opening:
        return "thinking"
    return "idle"


def _public_items(pending: list[dict[str, Any]]) -> list[dict[str, Any]]:
    from app.services.agent.turn_persist import slim_activity_item

    return [slim_activity_item(item) for item in pending if isinstance(item, dict)]


def status_view(
    pending: list[dict[str, Any]],
    *,
    worked: bool,
    speaking: bool,
    opening: bool = False,
) -> dict[str, Any] | None:
    """The one live line, plus image frames from the same view as saved history.

    Before the first thought or tool the line is ``activity.looking``. After a
    tool, the gap is ``activity.working``. Speech hides the line. Frames stay
    until the turn closes.
    """
    frames = frames_view(_public_items(pending))
    line: dict[str, Any] | None = None
    if not speaking:
        running = [item for item in pending if item.get("status") == "running" and item.get("tool")]
        if running:
            item = running[-1]
            shown = present_activity(item)
            line = {
                "label_key": shown.get("label_key") or "",
                "label": shown.get("label") or str(item.get("label") or ""),
                "label_params": shown.get("label_params") or None,
                "tool": str(item.get("tool") or ""),
                "host": shown.get("host") or "",
            }
        elif any(item.get("proposes") for item in pending):
            line = {"label_key": "proposal.preparing", "label": "", "label_params": None, "tool": "", "host": ""}
        elif worked:
            line = {"label_key": "activity.working", "label": "", "label_params": None, "tool": "", "host": ""}
        elif opening:
            line = {"label_key": "activity.looking", "label": "", "label_params": None, "tool": "", "host": ""}
    if line is None and not frames:
        return None
    body = line or {"label_key": "", "label": "", "label_params": None, "tool": "", "host": ""}
    body["frames"] = frames
    return body


def present_activity(item: dict[str, Any]) -> dict[str, Any]:
    """Display fields merged onto the slim activity item."""
    if item.get("kind") == "think":
        if item.get("status") == "running":
            return {"label_key": "activity.thinking"}
        if item.get("status") == "error":
            return {"label_key": "activity.thoughtFailed"}
        return {"label_key": "activity.thought"}

    tool = str(item.get("tool") or "")
    if tool == "generate_image":
        key = activity_label_key(item)
        return {"label_key": key} if key else {}
    if tool in _WEB_TOOLS:
        return _present_web(item, tool)
    if tool in _INVITE_TOOLS:
        return _present_invite(item)
    if tool in _PEER_TOOL_KEYS:
        name = _invite_name(item)
        key = _PEER_TOOL_KEYS[tool]
        return {"label_key": key, "label_params": {"name": name}} if name else {"label_key": f"{key}Someone"}
    if item.get("label") == "note":
        return {"label_key": "activity.note"}
    phrase = _tool_phrase(item)
    if phrase:
        return phrase
    return {}


# First matching token in the tool name is the verb. The rest is the object.
_VERB_TOKENS = (
    "list",
    "search",
    "fetch",
    "read",
    "get",
    "write",
    "create",
    "update",
    "delete",
    "set",
    "post",
    "send",
    "invite",
    "close",
    "suggest",
    "propose",
    "assign",
    "schedule",
    "restore",
    "start",
    "leave",
    "remember",
    "mark",
    "record",
    "request",
    "react",
    "resolve",
    "recommend",
    "register",
    "upsert",
    "clear",
    "file",
    "dispatch",
    "report",
    "ask",
    "attach",
    "connect",
    "link",
    "add",
    "cancel",
    "split",
    "call",
    "generate",
    "note",
    "take",
    "handoff",
    "continue",
    "follow",
)

_VERB_KEY = {
    "get": "read",
    "fetch": "fetch",
}


def _tool_phrase(item: dict[str, Any]) -> dict[str, Any] | None:
    """Running is the progressive, done is the past. The client translates both."""
    tool = str(item.get("tool") or "")
    if not tool:
        return None
    parts = [part for part in tool.split("_") if part]
    verb = ""
    object_parts: list[str] = []
    for index, part in enumerate(parts):
        if part in _VERB_TOKENS:
            verb = _VERB_KEY.get(part, part)
            object_parts = parts[index + 1 :]
            break
    if not verb:
        verb = "work"
        object_parts = parts
    status = str(item.get("status") or "")
    phase = "running" if status == "running" else "error" if status == "error" else "done"
    return {
        "label_key": f"activity.verb.{verb}.{phase}",
        "label_params": {"object": "_".join(object_parts) or "work"},
    }


def _present_web(item: dict[str, Any], tool: str) -> dict[str, Any]:
    host = _host(item, tool)
    out: dict[str, Any] = {}
    if host:
        out["host"] = host
        out["label"] = host
    elif tool == "web_search":
        out["label_key"] = "activity.webSearch"
        out["label_params"] = {"query": _query(item) or "…"}
    else:
        out["label_key"] = "activity.fetchUrl"
    favicon = _favicon(item, host)
    if favicon:
        out["favicon_url"] = favicon
    return out


def _present_invite(item: dict[str, Any]) -> dict[str, Any]:
    name = _invite_name(item)
    if name:
        return {"label_key": "activity.inviting", "label_params": {"name": name}}
    return {"label_key": "activity.invitingSomeone"}


def _record(value: Any) -> dict[str, Any] | None:
    if isinstance(value, dict):
        return value
    return None


def _query(item: dict[str, Any]) -> str:
    raw = _record(item.get("input"))
    if raw:
        query = str(raw.get("query") or "").strip()
        if query:
            return query[:200]
    label = str(item.get("label") or "")
    match = re.match(r"^Search:\s*(.+)$", label, re.IGNORECASE)
    return (match.group(1).strip()[:200] if match else "")


def _bare_host(value: str) -> str:
    host = value.strip().lower()
    return host[4:] if host.startswith("www.") else host


def _host_from_url(url: str) -> str:
    try:
        name = urlparse(url).hostname or ""
    except ValueError:
        return ""
    return _bare_host(name).lower()


def _host(item: dict[str, Any], tool: str) -> str:
    result = _record(item.get("result"))
    if result:
        if tool == "fetch_url":
            host = _bare_host(str(result.get("host") or ""))
            if host:
                return host.lower()
            from_url = _host_from_url(str(result.get("url") or ""))
            if from_url:
                return from_url
        for row in result.get("results") or []:
            if not isinstance(row, dict):
                continue
            host = _bare_host(str(row.get("host") or ""))
            if host:
                return host.lower()
            from_url = _host_from_url(str(row.get("url") or ""))
            if from_url:
                return from_url
    if tool == "fetch_url":
        raw = _record(item.get("input"))
        if raw:
            from_url = _host_from_url(str(raw.get("url") or ""))
            if from_url:
                return from_url
    match = _HOST_RE.search(_query(item))
    if not match:
        return ""
    return _bare_host(match.group(1)).lower()


def _favicon(item: dict[str, Any], host: str) -> str:
    result = _record(item.get("result"))
    if result:
        rows = result.get("results")
        if isinstance(rows, list) and rows and isinstance(rows[0], dict):
            url = str(rows[0].get("favicon_url") or "").strip()
            if url:
                return url[:240]
    if not host:
        return ""
    return f"https://www.google.com/s2/favicons?domain={host}&sz=32"


def _invite_name(item: dict[str, Any]) -> str:
    result = _record(item.get("result")) or {}
    raw = _record(item.get("input")) or {}
    return str(result.get("name") or result.get("agent_name") or raw.get("name") or "").strip()[:120]


_HIDDEN_TOOLS = frozenset({"attach_items", "update_progress", "post_internal_note"})


def spoken_text(text: str, history: dict[str, Any] | None) -> str:
    """Drop a picture the frames already show. The list payload uses this."""
    from app.services.agent.turn_persist import strip_generated_image_echo

    if not isinstance(history, dict):
        return text or ""
    urls = [
        str(frame.get("src") or "")
        for frame in history.get("frames") or []
        if isinstance(frame, dict) and frame.get("src")
    ]
    if not urls:
        return text or ""
    return strip_generated_image_echo(text or "", urls)


def frames_view(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One frame per generate_image call. The file URL is the only image source."""
    frames: list[dict[str, Any]] = []
    for item in items:
        if item.get("tool") != "generate_image":
            continue
        urls = [str(url) for url in (item.get("image_urls") or []) if url]
        if urls:
            for index, src in enumerate(urls[:4]):
                frames.append({"id": f"{item.get('id')}:{index}", "status": "ready", "src": src})
        elif item.get("status") == "error":
            frames.append({"id": str(item.get("id") or ""), "status": "error", "src": ""})
        else:
            frames.append({"id": str(item.get("id") or ""), "status": "running", "src": ""})
    return frames


def _visible(item: dict[str, Any]) -> bool:
    if item.get("tool") in _HIDDEN_TOOLS:
        return False
    if item.get("kind") == "think" and item.get("status") != "running":
        if item.get("text") is not None:
            return bool(str(item.get("text") or "").strip())
        return item.get("has_text") is not False
    return True


def _stamp(value: Any) -> float | None:
    if not isinstance(value, str) or not value:
        return None
    from datetime import datetime

    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def _duration_ms(items: list[dict[str, Any]]) -> int:
    starts = [stamp for item in items if (stamp := _stamp(item.get("started_at"))) is not None]
    ends = [stamp for item in items if (stamp := _stamp(item.get("ended_at"))) is not None]
    if not starts:
        return 0
    end = max(ends) if ends else max(starts)
    return max(0, int((end - min(starts)) * 1000))


def _row(kind: str, items: list[dict[str, Any]]) -> dict[str, Any]:
    duration = _duration_ms(items)
    if len(items) == 1 and kind != "think":
        item = items[0]
        return {
            "kind": kind,
            "count": 1,
            "duration_ms": duration,
            "label_key": str(item.get("label_key") or ""),
            "label": str(item.get("label") or ""),
            "label_params": item.get("label_params") or None,
            "tools": [str(item.get("tool"))] if item.get("tool") else [],
        }
    if kind == "think":
        key = "activity.thoughtBriefly" if duration < 1000 else "activity.thoughtFor"
        return {"kind": kind, "count": len(items), "duration_ms": duration, "label_key": key, "label": "", "label_params": None, "tools": _tools(items)}
    key = "activity.actionCount" if duration < 1000 else "activity.workedFor"
    return {"kind": kind, "count": len(items), "duration_ms": duration, "label_key": key, "label": "", "label_params": None, "tools": _tools(items)}


def _tools(items: list[dict[str, Any]]) -> list[str]:
    seen: list[str] = []
    for item in items:
        tool = str(item.get("tool") or "")
        if tool and tool not in seen:
            seen.append(tool)
    return seen


def history_view(items: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Collapsed rows and image frames for a saved message.

    Consecutive items of the same kind are one row. The client translates
    ``label_key`` and does not regroup the tools.
    """
    visible = [item for item in items if _visible(item)]
    frames = frames_view(visible)
    rows: list[dict[str, Any]] = []
    bucket: list[dict[str, Any]] = []
    bucket_kind = ""
    for item in visible:
        if item.get("tool") == "generate_image":
            continue
        kind = str(item.get("kind") or "work")
        if bucket and kind != bucket_kind:
            rows.append(_row(bucket_kind, bucket))
            bucket = []
        bucket.append(item)
        bucket_kind = kind
    if bucket:
        rows.append(_row(bucket_kind, bucket))
    images = [item for item in visible if item.get("tool") == "generate_image"]
    if images:
        image_row = _row("work", images)
        image_row["image"] = True
        rows.append(image_row)
    if not rows and not frames:
        return None
    return {"rows": rows, "frames": frames}
