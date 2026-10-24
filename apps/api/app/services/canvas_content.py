"""Store and check every canvas kind except the dashboard compiler.

A dashboard still goes through ``project_canvas_compile``. The other kinds
keep their source as text or JSON. Images and drawing ``<image>`` tags may
only point at a file stored for this tenant. A canvas still has one home
thread; nothing here opens a second one.
"""

from __future__ import annotations

import json
import re
from html.parser import HTMLParser
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project_canvas import (
    CANVAS_KINDS,
    KIND_CODE,
    KIND_DIAGRAM,
    KIND_DOCUMENT,
    KIND_DRAWING,
    KIND_DESIGN,
    KIND_EMAIL,
    KIND_IMAGE,
    KIND_SHEET,
)
from app.services.storage import storage_key_from_url

_MAX_SOURCE = 80_000
_LANG_RE = re.compile(r"^[a-z0-9_+#.-]{1,32}$")
_SCRIPT_BLOCK = re.compile(r"<\s*script\b[^>]*>.*?<\s*/\s*script\s*>", re.I | re.S)
_FOREIGN = re.compile(r"<\s*foreignObject\b[^>]*>.*?<\s*/\s*foreignObject\s*>", re.I | re.S)
_ON_ATTR = re.compile(r"""\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)""", re.I)
_HREF = re.compile(
    r"""(?P<prefix>\b(?:xlink:)?)href\s*=\s*(?P<q>['"])(?P<url>.*?)(?P=q)""",
    re.I | re.S,
)
_XML_DECL = re.compile(r"<\?xml[^>]*\?>", re.I)
_DANGER = re.compile(r"<\s*(?:script|iframe|object|embed|foreignObject)\b|javascript:", re.I)
_HTML_TAG = re.compile(r"</?[a-zA-Z][^>]*>")

_EMAIL_TAGS = frozenset(
    {"p", "h1", "h2", "h3", "a", "strong", "em", "br", "ul", "ol", "li", "table", "thead", "tbody", "tr", "th", "td", "img"}
)
_EMAIL_VOID = frozenset({"br", "img"})
_EMAIL_SKIP = frozenset({"script", "style", "iframe", "object", "embed"})


class CanvasContentError(ValueError):
    """The source is not valid for its kind."""


def normalize_kind(value: str | None) -> str:
    kind = (value or "dashboard").strip().lower()
    if kind not in CANVAS_KINDS:
        raise CanvasContentError(
            "kind must be dashboard, document, diagram, drawing, image, code, email, sheet, or design"
        )
    return kind


def edit_body_hint(kind: str | None) -> str:
    """What edit_canvas expects after create, by kind."""
    return str(edit_body_contract(kind)["hint_short"])


def edit_body_contract(kind: str | None) -> dict[str, Any]:
    """Machine-readable body for the next edit_canvas call.

    ``field`` is the tool argument to fill. ``example`` is a tiny valid body.
    ``hint`` is the full retry line for agents and MCP.
    """
    name = (kind or "dashboard").strip().lower() or "dashboard"
    if name == "dashboard":
        from app.services.canvas_skills import skill_brief

        brief = skill_brief(None)
        example = brief["example"][:4]
        return {
            "kind": "dashboard",
            "field": "blocks",
            "example": example,
            "hint_short": (
                "blocks (stat, bar_chart, line_chart, pie_chart, table, heading, text, …)"
            ),
            "hint": (
                "Call edit_canvas with blocks like the edit_example. "
                "Every stat, chart, pie and table needs source.tool_use_id. "
                "Then finish_canvas. Do not paste blocks in chat."
            ),
        }
    if name == KIND_DOCUMENT:
        example = "# Title\n\nOne short paragraph."
        return _source_contract(name, example, "source (markdown)")
    if name == KIND_DIAGRAM:
        example = "flowchart TD\n  A-->B"
        return _source_contract(name, example, "source (Mermaid)")
    if name == KIND_DRAWING:
        example = (
            '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80">'
            '<rect width="120" height="80" fill="#e8e8e5"/></svg>'
        )
        return _source_contract(name, example, "source (one SVG)")
    if name == KIND_CODE:
        return {
            "kind": name,
            "field": "source",
            "example": "select 1;",
            "language": "sql",
            "hint_short": "source and language",
            "hint": (
                "Call edit_canvas with source set to edit_example and language "
                '"sql". Then finish_canvas. Do not paste the code in chat.'
            ),
        }
    if name == KIND_SHEET:
        example = {"columns": ["Dag", "Temp"], "rows": [["za", "12"]]}
        return {
            "kind": name,
            "field": "source",
            "example": example,
            "hint_short": "source (JSON columns and rows, or tabs)",
            "hint": (
                "Call edit_canvas with source set to edit_example "
                "(columns and rows, or tabs). Not blocks, not a heading or a "
                "stat. Then finish_canvas. Do not paste the sheet in chat."
            ),
        }
    if name == KIND_EMAIL:
        example = {
            "subject": "Subject line",
            "preheader": "",
            "body_html": "<p>Hello.</p>",
        }
        return _source_contract(name, example, "source (JSON subject, preheader, body_html)")
    if name == KIND_IMAGE:
        return {
            "kind": name,
            "field": "image_prompt",
            "example": "A calm product photo on a white desk",
            "hint_short": "image_prompt or image_url",
            "hint": (
                "Call edit_canvas with image_prompt set to edit_example "
                "(or a workspace image_url). Then finish_canvas. "
                "Do not paste the image in chat."
            ),
        }
    if name == KIND_DESIGN:
        example = {
            "frames": [
                {
                    "id": "f1",
                    "x": 32,
                    "y": 32,
                    "w": 320,
                    "h": 220,
                    "title": "Frame",
                    "text": "Plain text only.",
                }
            ]
        }
        return _source_contract(
            name, example, "source (JSON frames: id, x, y, w, h, title, text)"
        )
    return _source_contract(name or "document", "", "source")


def _source_contract(kind: str, example: Any, hint_short: str) -> dict[str, Any]:
    return {
        "kind": kind,
        "field": "source",
        "example": example,
        "hint_short": hint_short,
        "hint": (
            f"Call edit_canvas with source set to edit_example. "
            f"This canvas is a {kind}. Then finish_canvas. "
            "Do not paste the body in chat."
        ),
    }


def attach_edit_contract(reply: dict[str, Any], kind: str | None) -> dict[str, Any]:
    """Put edit_field / edit_example / hint on a create or exists reply."""
    contract = edit_body_contract(kind)
    reply["edit_field"] = contract["field"]
    reply["edit_example"] = contract["example"]
    reply["hint"] = contract["hint"]
    if contract.get("language"):
        reply["edit_language"] = contract["language"]
    return reply


def invalid_edit_for_kind(kind: str | None, *, error: str) -> dict[str, Any]:
    """Refuse an edit and hand back the same example create would have given."""
    contract = edit_body_contract(kind)
    return {
        "status": "invalid",
        "error": error,
        "edit_field": contract["field"],
        "edit_example": contract["example"],
        "hint": contract["hint"],
    }


def retarget_kind_edit(
    kind: str | None,
    blocks: Any,
    source: Any,
) -> tuple[Any, Any, dict[str, Any] | None]:
    """Keep dashboard blocks on a dashboard. A sheet stores the table as source.

    Other kinds refuse dashboard blocks so the edit error names their body,
    not a dashboard rule.
    """
    name = (kind or "").strip().lower()
    if not name or name == "dashboard" or blocks is None:
        return blocks, source, None
    if source is not None:
        return None, source, None
    if name == KIND_SHEET:
        from app.services.canvas_sheet import source_from_blocks

        # Empty list is a failed dashboard-shaped guess, not a table to convert.
        if isinstance(blocks, list) and len(blocks) == 0:
            return None, None, invalid_edit_for_kind(
                name,
                error=(
                    "This canvas is a sheet. Pass source with columns and rows "
                    "(see edit_example). Not an empty blocks list."
                ),
            )
        try:
            converted = source_from_blocks(blocks)
        except CanvasContentError as exc:
            return None, None, invalid_edit_for_kind(name, error=str(exc))
        if converted:
            return None, converted, None
        return None, None, invalid_edit_for_kind(
            name,
            error=(
                "This canvas is a sheet. Pass source with columns and rows "
                "(see edit_example). Not a heading or a stat."
            ),
        )
    return None, None, invalid_edit_for_kind(
        name,
        error=(
            f"This canvas is a {name}. Pass {edit_body_hint(name)} "
            "(see edit_example), not dashboard blocks."
        ),
    )


def tenant_file_url(url: str, tenant_id: str) -> bool:
    """True when the URL is a stored file for this tenant."""
    key = storage_key_from_url(url or "")
    if not key:
        return False
    tenant, _, name = key.partition("/")
    return tenant == str(tenant_id) and bool(name) and ".." not in name


def content_is_empty(kind: str, source: str | None) -> bool:
    text = (source or "").strip()
    if kind in (KIND_DOCUMENT, KIND_DIAGRAM, KIND_DRAWING, KIND_CODE):
        return not text
    if not text:
        return True
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return True
    if not isinstance(data, dict):
        return True
    if kind == KIND_IMAGE:
        return not str(data.get("url") or "").strip()
    if kind == KIND_EMAIL:
        return not str(data.get("subject") or "").strip() and not str(data.get("body_html") or "").strip()
    if kind == KIND_SHEET:
        from app.services.canvas_sheet import is_empty

        return is_empty(text)
    if kind == KIND_DESIGN:
        frames = data.get("frames") if isinstance(data, dict) else None
        if not isinstance(frames, list) or not frames:
            return True
        return not any(
            str(frame.get("title") or frame.get("text") or "").strip()
            for frame in frames
            if isinstance(frame, dict)
        )
    return not text


def _frame_number(value: Any, default: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    if number != number or number in (float("inf"), float("-inf")):
        return default
    return number


def _clamp(number: float, low: float, high: float) -> float:
    return min(high, max(low, number))


def normalize_design(text: str) -> str:
    """A design is a list of plain-text frames. No HTML, scripts, or remote URLs."""
    raw = (text or "").strip()
    if not raw:
        return json.dumps({"frames": []}, ensure_ascii=False)
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise CanvasContentError(
            'A design is JSON: {"frames":[{"id","x","y","w","h","title","text"}]}'
        ) from exc
    frames = data.get("frames") if isinstance(data, dict) else data
    if not isinstance(frames, list):
        raise CanvasContentError("A design needs a frames list")
    if len(frames) > 24:
        raise CanvasContentError("A design holds at most 24 frames")
    cleaned: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, frame in enumerate(frames):
        if not isinstance(frame, dict):
            raise CanvasContentError("Each frame is an object with id, x, y, w, h, title and text")
        frame_id = re.sub(r"[^a-zA-Z0-9_-]", "", str(frame.get("id") or ""))[:40]
        if not frame_id:
            frame_id = f"f{index + 1}"
        base = frame_id
        suffix = 2
        while frame_id in seen:
            frame_id = f"{base}-{suffix}"[:40]
            suffix += 1
        seen.add(frame_id)
        title = _HTML_TAG.sub("", str(frame.get("title") or ""))
        body = _HTML_TAG.sub("", str(frame.get("text") or ""))
        cleaned.append(
            {
                "id": frame_id,
                "x": round(_clamp(_frame_number(frame.get("x"), 32), 0, 4000), 1),
                "y": round(_clamp(_frame_number(frame.get("y"), 32 + index * 24), 0, 4000), 1),
                "w": round(_clamp(_frame_number(frame.get("w"), 320), 160, 960), 1),
                "h": round(_clamp(_frame_number(frame.get("h"), 220), 120, 800), 1),
                "title": title.strip()[:80],
                "text": body.strip()[:4000],
            }
        )
    return json.dumps({"frames": cleaned}, ensure_ascii=False)


def coerce_canvas_source(value: Any) -> str | None:
    """A tool may pass source as a string or as the JSON object it meant."""
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    text = str(value).strip()
    return text or None


def prepare_content(
    kind: str,
    source: str | None,
    *,
    language: str | None,
    tenant_id: UUID | str,
) -> tuple[str, str | None]:
    """Return ``(stored_source, language)``. Language is set only for code."""
    kind = normalize_kind(kind)
    text = source if isinstance(source, str) else ""
    if len(text) > _MAX_SOURCE:
        raise CanvasContentError("Canvas source is too long")
    tenant = str(tenant_id)
    if kind == KIND_DOCUMENT:
        if _DANGER.search(text):
            raise CanvasContentError("A document is markdown, not HTML")
        return _HTML_TAG.sub("", text).strip(), None
    if kind == KIND_DIAGRAM:
        if _DANGER.search(text):
            raise CanvasContentError("A diagram cannot include scripts")
        return text.strip(), None
    if kind == KIND_DRAWING:
        return sanitize_svg(text, tenant), None
    if kind == KIND_CODE:
        return text.replace("\r\n", "\n"), _language(language)
    if kind == KIND_IMAGE:
        return _image_json(text, tenant), None
    if kind == KIND_EMAIL:
        return _email_json(text, tenant), None
    if kind == KIND_SHEET:
        from app.services.canvas_sheet import normalize_source

        return normalize_source(text), None
    if kind == KIND_DESIGN:
        return normalize_design(text), None
    raise CanvasContentError("Dashboard source is compiled, not stored raw")


def sanitize_svg(source: str, tenant_id: str) -> str:
    body = _XML_DECL.sub("", source or "").strip()
    if not body.lower().startswith("<svg"):
        raise CanvasContentError("A drawing must be one SVG document")
    if len(body) > _MAX_SOURCE:
        raise CanvasContentError("Canvas source is too long")
    body = _SCRIPT_BLOCK.sub("", body)
    body = _FOREIGN.sub("", body)
    body = _ON_ATTR.sub("", body)

    def _href(match: re.Match[str]) -> str:
        url = match.group("url").strip()
        if tenant_file_url(url, tenant_id):
            return match.group(0)
        return ""

    body = _HREF.sub(_href, body)
    body = re.sub(r"javascript:[^\"'\s>]*", "", body, flags=re.I)
    return body.strip()


def _language(value: str | None) -> str:
    lang = (value or "text").strip().lower()
    if not _LANG_RE.match(lang):
        raise CanvasContentError("Code language must be a short name such as python or sql")
    return lang


def _loads_object(raw: str) -> dict[str, Any]:
    text = (raw or "").strip()
    if not text:
        return {}
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise CanvasContentError("This canvas kind stores a JSON object") from exc
    if not isinstance(data, dict):
        raise CanvasContentError("This canvas kind stores a JSON object")
    return data


def _image_json(raw: str, tenant_id: str) -> str:
    data = _loads_object(raw)
    url = str(data.get("url") or "").strip()
    if url and not tenant_file_url(url, tenant_id):
        raise CanvasContentError("Image URL must be a file stored for this workspace")
    alt = str(data.get("alt") or "").strip()[:200]
    return json.dumps({"url": url, "alt": alt}, ensure_ascii=False)


def _email_json(raw: str, tenant_id: str) -> str:
    data = _loads_object(raw)
    subject = str(data.get("subject") or "").strip()[:200]
    preheader = str(data.get("preheader") or "").strip()[:300]
    body = sanitize_email_html(str(data.get("body_html") or ""), tenant_id)
    return json.dumps(
        {"subject": subject, "preheader": preheader, "body_html": body},
        ensure_ascii=False,
    )


def _esc(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


class _EmailCleaner(HTMLParser):
    def __init__(self, tenant_id: str) -> None:
        super().__init__(convert_charrefs=True)
        self.tenant_id = tenant_id
        self.out: list[str] = []
        self.skip = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        name = tag.lower()
        if name in _EMAIL_SKIP:
            self.skip += 1
            return
        if self.skip or name not in _EMAIL_TAGS:
            return
        attr = {key.lower(): (value or "") for key, value in attrs}
        kept: list[tuple[str, str]] = []
        if name == "a":
            href = attr.get("href", "").strip()
            if href.startswith(("https://", "http://", "mailto:")) and "javascript:" not in href.lower():
                kept.append(("href", href))
        if name == "img":
            src = attr.get("src", "").strip()
            if not tenant_file_url(src, self.tenant_id):
                return
            kept.append(("src", src))
            kept.append(("alt", attr.get("alt", "")[:200]))
        rendered = "".join(f' {key}="{_esc(value)}"' for key, value in kept)
        if name in _EMAIL_VOID:
            self.out.append(f"<{name}{rendered} />")
        else:
            self.out.append(f"<{name}{rendered}>")

    def handle_endtag(self, tag: str) -> None:
        name = tag.lower()
        if name in _EMAIL_SKIP and self.skip:
            self.skip -= 1
            return
        if self.skip or name not in _EMAIL_TAGS or name in _EMAIL_VOID:
            return
        self.out.append(f"</{name}>")

    def handle_data(self, data: str) -> None:
        if self.skip or not data:
            return
        self.out.append(_esc(data))


def sanitize_email_html(source: str, tenant_id: str) -> str:
    cleaner = _EmailCleaner(tenant_id)
    cleaner.feed(source or "")
    cleaner.close()
    return "".join(cleaner.out).strip()


async def stored_image_from_prompt(session: AsyncSession, tenant_id: UUID, prompt: str) -> str:
    """Generate one picture and store it for this tenant. Returns the file URL."""
    from app.services.image_generation import generate_image, resolve_image_model_slug
    from app.services.storage import get_storage_backend
    from app.tools.images import _image_bytes

    text = (prompt or "").strip()
    if not text:
        raise CanvasContentError("Image prompt is required")
    slug = await resolve_image_model_slug(session, tenant_id, agent_slug="")
    if not slug:
        raise CanvasContentError("Image generation is turned off for this workspace")
    generated = await generate_image(session, tenant_id, text, model_slug=slug)
    if generated.mock:
        raise CanvasContentError("No image provider key is configured")
    backend = get_storage_backend()
    for index, image in enumerate(generated.result.images):
        decoded = _image_bytes(image)
        if not decoded:
            continue
        payload, mime, ext = decoded
        stored = await backend.store(
            data=payload,
            filename=f"canvas-{index + 1}.{ext}",
            mime=mime,
            tenant_id=str(tenant_id),
        )
        return stored.url
    raise CanvasContentError("The image provider returned no file")


async def materialize_image(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    source: str | None = None,
    prompt: str | None = None,
    image_url: str | None = None,
    alt: str = "",
) -> str:
    """JSON source for an image canvas. A prompt is generated and stored first."""
    if (prompt or "").strip():
        url = await stored_image_from_prompt(session, tenant_id, prompt or "")
        return _image_json(
            json.dumps({"url": url, "alt": (alt or prompt or "")[:200]}),
            str(tenant_id),
        )
    if (image_url or "").strip():
        return _image_json(
            json.dumps({"url": image_url, "alt": alt[:200]}),
            str(tenant_id),
        )
    if source is not None:
        return _image_json(source, str(tenant_id))
    return _image_json("", str(tenant_id))

