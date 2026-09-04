"""Knowledge pages + atomic sections.

Sections (`doc_sections`) become the atomic knowledge unit: one topic, own
maturity status (draft/review/final), own embedding chunks. Existing doc
content is split on `##` headings; legacy `project_doc_sections` statuses map
onto the new maturity scale and section ids are preserved where the anchor
still exists so `task_doc_links.section_id` stays valid.

Revision ID: 032_doc_sections
Revises: 031_oauth_state_context
"""

import re
import uuid
from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision = "032_doc_sections"
down_revision = "031_oauth_state_context"
branch_labels = None
depends_on = None

_HEADING_RE = re.compile(r"^##\s+(.+?)\s*$")

# Legacy project section statuses -> maturity scale.
_STATUS_MAP = {
    "open": "draft",
    "planned": "draft",
    "in_progress": "draft",
    "implemented": "review",
    "verified": "final",
}


def _anchor_from(heading: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", heading.lower()).strip("-")
    return slug[:120] or "section"


def _split_sections(content: str) -> list[tuple[str, str]]:
    sections: list[tuple[str, list[str]]] = []
    heading = ""
    lines: list[str] = []
    for line in (content or "").splitlines():
        match = _HEADING_RE.match(line)
        if match:
            if lines or heading:
                sections.append((heading, lines))
            heading = match.group(1).strip()
            lines = []
        else:
            lines.append(line)
    if lines or heading:
        sections.append((heading, lines))
    out: list[tuple[str, str]] = []
    for head, body_lines in sections:
        body = "\n".join(body_lines).strip()
        if not head and not body:
            continue
        out.append((head, body))
    return out


def upgrade() -> None:
    op.create_table(
        "doc_sections",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("doc_id", sa.Uuid(), sa.ForeignKey("workspace_docs.id"), nullable=False),
        sa.Column("anchor", sa.String(), nullable=False),
        sa.Column("heading", sa.String(), nullable=False, server_default=""),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("content", sa.String(), nullable=False, server_default=""),
        sa.Column("status", sa.String(), nullable=False, server_default="draft"),
        sa.Column("status_changed_at", sa.DateTime(), nullable=True),
        sa.Column("status_changed_by_type", sa.String(), nullable=False, server_default=""),
        sa.Column("status_changed_by_id", sa.String(), nullable=False, server_default=""),
        sa.Column("summary", sa.String(), nullable=False, server_default=""),
        sa.Column("edited_by_type", sa.String(), nullable=False, server_default="user"),
        sa.Column("edited_by_id", sa.String(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("doc_id", "anchor", name="uq_doc_sections_anchor"),
    )
    op.create_index("ix_doc_sections_tenant_id", "doc_sections", ["tenant_id"])
    op.create_index("ix_doc_sections_doc_id", "doc_sections", ["doc_id"])
    op.create_index("ix_doc_sections_status", "doc_sections", ["status"])

    op.add_column("doc_chunks", sa.Column("section_id", sa.Uuid(), nullable=True))
    op.create_index("ix_doc_chunks_section_id", "doc_chunks", ["section_id"])
    op.create_foreign_key(
        "fk_doc_chunks_section_id_doc_sections",
        "doc_chunks",
        "doc_sections",
        ["section_id"],
        ["id"],
    )

    bind = op.get_bind()
    now = datetime.utcnow()

    # Legacy project sections keyed by (doc_id, anchor): reuse ids + statuses.
    legacy: dict[tuple[str, str], dict] = {}
    inspector = sa.inspect(bind)
    has_legacy = inspector.has_table("project_doc_sections")
    if has_legacy:
        for row in bind.execute(
            sa.text(
                "SELECT id, doc_id, anchor, status, status_changed_at, "
                "status_changed_by_type, status_changed_by_id, summary "
                "FROM project_doc_sections"
            )
        ).mappings():
            legacy[(str(row["doc_id"]), row["anchor"])] = dict(row)

    section_insert = sa.table(
        "doc_sections",
        sa.column("id", sa.Uuid()),
        sa.column("tenant_id", sa.Uuid()),
        sa.column("doc_id", sa.Uuid()),
        sa.column("anchor", sa.String()),
        sa.column("heading", sa.String()),
        sa.column("position", sa.Integer()),
        sa.column("content", sa.String()),
        sa.column("status", sa.String()),
        sa.column("status_changed_at", sa.DateTime()),
        sa.column("status_changed_by_type", sa.String()),
        sa.column("status_changed_by_id", sa.String()),
        sa.column("summary", sa.String()),
        sa.column("edited_by_type", sa.String()),
        sa.column("edited_by_id", sa.String()),
        sa.column("created_at", sa.DateTime()),
        sa.column("updated_at", sa.DateTime()),
    )

    valid_section_ids: set[str] = set()
    docs = bind.execute(
        sa.text("SELECT id, tenant_id, content, created_by_type FROM workspace_docs")
    ).mappings()
    for doc in docs:
        seen: set[str] = set()
        rows = []
        for position, (heading, body) in enumerate(_split_sections(doc["content"] or "")):
            anchor = _anchor_from(heading) if heading else "_intro"
            if anchor in seen:
                continue
            seen.add(anchor)
            old = legacy.get((str(doc["id"]), anchor))
            section_id = uuid.UUID(str(old["id"])) if old else uuid.uuid4()
            status = _STATUS_MAP.get(old["status"], "draft") if old else "draft"
            rows.append(
                {
                    "id": section_id,
                    "tenant_id": uuid.UUID(str(doc["tenant_id"])),
                    "doc_id": uuid.UUID(str(doc["id"])),
                    "anchor": anchor,
                    "heading": heading,
                    "position": position,
                    "content": body,
                    "status": status,
                    "status_changed_at": old["status_changed_at"] if old else None,
                    "status_changed_by_type": (old["status_changed_by_type"] or "") if old else "",
                    "status_changed_by_id": (old["status_changed_by_id"] or "") if old else "",
                    "summary": (old["summary"] or "") if old else "",
                    "edited_by_type": doc["created_by_type"] or "user",
                    "edited_by_id": "",
                    "created_at": now,
                    "updated_at": now,
                }
            )
            valid_section_ids.add(str(section_id))
        if rows:
            bind.execute(section_insert.insert(), rows)

    # Links pointing at sections whose heading no longer exists (deprecated
    # rows) lose the section pointer; the document-level doc_id link remains.
    if has_legacy:
        stale = [
            str(row["id"])
            for row in bind.execute(
                sa.text("SELECT id FROM project_doc_sections")
            ).mappings()
            if str(row["id"]) not in valid_section_ids
        ]
        if stale:
            links = sa.table(
                "task_doc_links",
                sa.column("section_id", sa.Uuid()),
                sa.column("doc_id", sa.Uuid()),
            )
            bind.execute(
                links.update()
                .where(links.c.section_id.in_([uuid.UUID(s) for s in stale]))
                .values(section_id=None)
            )

        # Re-point the FK from project_doc_sections to doc_sections, then drop
        # the legacy table. SQLite does not enforce these FKs; Postgres needs
        # the constraint swap before the drop.
        if bind.dialect.name == "postgresql":
            fk_names = [
                fk["name"]
                for fk in inspector.get_foreign_keys("task_doc_links")
                if fk.get("referred_table") == "project_doc_sections"
            ]
            for name in fk_names:
                op.drop_constraint(name, "task_doc_links", type_="foreignkey")
            op.create_foreign_key(
                "fk_task_doc_links_section_id_doc_sections",
                "task_doc_links",
                "doc_sections",
                ["section_id"],
                ["id"],
            )
        op.drop_table("project_doc_sections")


def downgrade() -> None:
    # Build-phase forward-only migration: the legacy project_doc_sections
    # layer is not reconstructed.
    if op.get_bind().dialect.name == "postgresql":
        op.drop_constraint(
            "fk_task_doc_links_section_id_doc_sections", "task_doc_links", type_="foreignkey"
        )
    op.drop_constraint("fk_doc_chunks_section_id_doc_sections", "doc_chunks", type_="foreignkey")
    op.drop_index("ix_doc_chunks_section_id", table_name="doc_chunks")
    op.drop_column("doc_chunks", "section_id")
    op.drop_index("ix_doc_sections_status", table_name="doc_sections")
    op.drop_index("ix_doc_sections_doc_id", table_name="doc_sections")
    op.drop_index("ix_doc_sections_tenant_id", table_name="doc_sections")
    op.drop_table("doc_sections")
