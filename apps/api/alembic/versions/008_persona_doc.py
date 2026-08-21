"""Persona single-store: fold assistant_personas into the persona.md doc.

Revision ID: 008_persona_doc
Revises: 007_custom_metrics

The tone/do/don't persona settings now live as structured sections in the
persona.md workspace doc (the doc agents already read in their system
prompt). This migration copies any non-empty persona rows into that doc and
drops the now-duplicate table.
"""

import uuid
from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision = "008_persona_doc"
down_revision = "007_custom_metrics"
branch_labels = None
depends_on = None


def _render_doc(tone: str, do_text: str, dont_text: str) -> str:
    parts = ["# Persona"]
    if tone.strip():
        parts.append(f"## Tone\n{tone.strip()}")
    if do_text.strip():
        parts.append(f"## Do\n{do_text.strip()}")
    if dont_text.strip():
        parts.append(f"## Don't\n{dont_text.strip()}")
    return "\n\n".join(parts) + "\n"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "assistant_personas" not in tables:
        return

    if "workspace_docs" in tables:
        rows = bind.execute(
            sa.text(
                "SELECT tenant_id, tone, do_text, dont_text FROM assistant_personas "
                "WHERE COALESCE(tone, '') != '' OR COALESCE(do_text, '') != '' "
                "OR COALESCE(dont_text, '') != ''"
            )
        ).fetchall()
        for tenant_id, tone, do_text, dont_text in rows:
            content = _render_doc(tone or "", do_text or "", dont_text or "")
            existing = bind.execute(
                sa.text(
                    "SELECT id, content FROM workspace_docs "
                    "WHERE tenant_id = :tenant_id AND path = 'persona.md'"
                ),
                {"tenant_id": tenant_id},
            ).fetchone()
            if existing is not None:
                # Only overwrite untouched defaults; keep docs someone edited.
                current = (existing[1] or "").strip()
                is_default = current.startswith("# Persona") and len(current) < 200
                if is_default:
                    bind.execute(
                        sa.text(
                            "UPDATE workspace_docs SET content = :content, updated_at = :now "
                            "WHERE id = :id"
                        ),
                        {"content": content, "now": datetime.utcnow(), "id": existing[0]},
                    )
            else:
                bind.execute(
                    sa.text(
                        "INSERT INTO workspace_docs "
                        "(id, tenant_id, path, title, kind, content, frontmatter_json, "
                        "is_pinned, sort_order, created_by_type, created_by_id, created_at, "
                        "updated_at) "
                        "VALUES (:id, :tenant_id, 'persona.md', 'Persona', 'persona', :content, "
                        "'{}', false, 0, 'system', '', :now, :now)"
                    ),
                    {
                        "id": uuid.uuid4(),
                        "tenant_id": tenant_id,
                        "content": content,
                        "now": datetime.utcnow(),
                    },
                )

    op.drop_table("assistant_personas")


def downgrade() -> None:
    op.create_table(
        "assistant_personas",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("tone", sa.String(), nullable=False, server_default=""),
        sa.Column("do_text", sa.String(), nullable=False, server_default=""),
        sa.Column("dont_text", sa.String(), nullable=False, server_default=""),
        sa.Column("escalation_prefs_json", sa.String(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_assistant_personas_tenant_id", "assistant_personas", ["tenant_id"])
