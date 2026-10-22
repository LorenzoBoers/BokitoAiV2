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
            "kind must be dashboard, document, diagram, drawing, image, code, email, or sheet"
        )
    return kind


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
    return not text


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

