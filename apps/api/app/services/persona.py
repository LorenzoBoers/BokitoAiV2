"""Assistant persona, stored in the persona.md workspace doc.

Single source of truth: agents read persona.md through
`build_workspace_context`, the Messenger settings Tone/Do/Don't form reads and
writes structured sections in the same doc, and approved Govern persona
reviews append their guidance here. There is no separate persona table.
"""

from __future__ import annotations

import re
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

PERSONA_DOC_PATH = "persona.md"

# Sections owned by the Tone/Do/Don't form; everything else in the doc
# (e.g. appended feedback reviews) is preserved verbatim on save.
_MANAGED_HEADINGS = {"tone": "tone", "do": "do_text", "don't": "dont_text", "dont": "dont_text"}


def _normalize_heading(heading: str) -> str:
    return heading.strip().lower().rstrip(":").replace("\u2019", "'")


def _split_sections(content: str) -> tuple[str, list[tuple[str, str]]]:
    """Split markdown into (preamble, [(heading, body)]) on `## ` headings."""
    preamble: list[str] = []
    sections: list[tuple[str, list[str]]] = []
    current: list[str] | None = None
    for line in (content or "").splitlines():
        if line.startswith("## "):
            current = []
            sections.append((line[3:].strip(), current))
        elif current is not None:
            current.append(line)
        else:
            preamble.append(line)
    return (
        "\n".join(preamble).strip(),
        [(heading, "\n".join(body).strip()) for heading, body in sections],
    )


def parse_persona_doc(content: str) -> dict[str, str]:
    """Extract tone / do_text / dont_text from a persona.md document.

    Legacy freeform docs (no managed sections) surface their body as tone so
    nothing silently disappears from the settings form.
    """
    preamble, sections = _split_sections(content)
    fields = {"tone": "", "do_text": "", "dont_text": ""}
    matched = False
    for heading, body in sections:
        key = _MANAGED_HEADINGS.get(_normalize_heading(heading))
        if key:
            fields[key] = body
            matched = True
    if not matched:
        fields["tone"] = re.sub(r"^#\s.*$", "", preamble, flags=re.MULTILINE).strip()
    return fields


def render_persona_doc(
    tone: str, do_text: str, dont_text: str, extra_sections: list[tuple[str, str]] | None = None
) -> str:
    parts = ["# Persona"]
    if tone.strip():
        parts.append(f"## Tone\n{tone.strip()}")
    if do_text.strip():
        parts.append(f"## Do\n{do_text.strip()}")
    if dont_text.strip():
        parts.append(f"## Don't\n{dont_text.strip()}")
    for heading, body in extra_sections or []:
        parts.append(f"## {heading}\n{body}".rstrip())
    return "\n\n".join(parts) + "\n"


async def get_persona_fields(session: AsyncSession, tenant_id: UUID) -> dict[str, str]:
    from app.services.workspace import get_doc_by_path

    doc = await get_doc_by_path(session, tenant_id, PERSONA_DOC_PATH)
    if not doc or not doc.content.strip():
        return {"tone": "", "do_text": "", "dont_text": ""}
    return parse_persona_doc(doc.content)


async def update_persona_fields(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    tone: str | None = None,
    do_text: str | None = None,
    dont_text: str | None = None,
    created_by_id: str = "",
) -> dict[str, str]:
    """Merge form updates into persona.md, preserving unmanaged sections."""
    from app.services.workspace import get_doc_by_path, upsert_doc

    doc = await get_doc_by_path(session, tenant_id, PERSONA_DOC_PATH)
    existing_content = doc.content if doc else ""
    fields = parse_persona_doc(existing_content) if existing_content.strip() else {
        "tone": "",
        "do_text": "",
        "dont_text": "",
    }
    if tone is not None:
        fields["tone"] = tone
    if do_text is not None:
        fields["do_text"] = do_text
    if dont_text is not None:
        fields["dont_text"] = dont_text

    _, sections = _split_sections(existing_content)
    extra = [
        (heading, body)
        for heading, body in sections
        if _normalize_heading(heading) not in _MANAGED_HEADINGS
    ]
    await upsert_doc(
        session,
        tenant_id,
        path=PERSONA_DOC_PATH,
        content=render_persona_doc(
            fields["tone"], fields["do_text"], fields["dont_text"], extra_sections=extra
        ),
        kind="persona",
        created_by_type="user",
        created_by_id=created_by_id,
    )
    return fields


async def append_persona_section(
    session: AsyncSession, tenant_id: UUID, *, heading: str, body: str
) -> None:
    """Append a new `## heading` section to persona.md (e.g. approved reviews)."""
    from app.services.workspace import get_doc_by_path, upsert_doc

    doc = await get_doc_by_path(session, tenant_id, PERSONA_DOC_PATH)
    existing = (doc.content if doc else "").rstrip()
    base = existing or "# Persona"
    content = f"{base}\n\n## {heading}\n{body.strip()}\n"
    await upsert_doc(
        session,
        tenant_id,
        path=PERSONA_DOC_PATH,
        content=content,
        kind="persona",
        created_by_type="system",
    )
