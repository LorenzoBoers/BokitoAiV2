"""Canvas belongs only to its conversation; drop folder owner columns.

Revision ID: 147_canvas_thread_only
Revises: 146_agent_effort

Before dropping owner_kind / owner_id / project_id:
- delete kind=brand rows;
- delete canvases with no signal_id;
- when a canvas owner folder is not General/Algemeen and the home thread
  has no project_id, file that thread into the owner folder so the canvas
  stays visible on that folder tab (ChargeCars case).
"""

from __future__ import annotations

import uuid
from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision = "147_canvas_thread_only"
down_revision = "146_agent_effort"
branch_labels = None
depends_on = None


def _indexes(bind, table: str) -> set[str]:
    return {ix["name"] for ix in sa.inspect(bind).get_indexes(table)}


def _columns(bind, table: str) -> set[str]:
    return {col["name"] for col in sa.inspect(bind).get_columns(table)}


def _file_threads_into_owner_folders(bind) -> None:
    """Copy folder tags onto the home thread and set signals.project_id."""
    rows = bind.execute(
        sa.text(
            """
            SELECT c.signal_id, c.owner_id, c.tenant_id
            FROM project_canvases c
            JOIN projects p ON p.id = c.owner_id AND p.tenant_id = c.tenant_id
            JOIN signals s ON s.id = c.signal_id AND s.tenant_id = c.tenant_id
            WHERE c.signal_id IS NOT NULL
              AND c.deleted_at IS NULL
              AND s.project_id IS NULL
              AND p.deleted_at IS NULL
              AND p.name NOT IN ('Algemeen', 'General')
            """
        ),
    ).fetchall()
    now = datetime.utcnow()
    for signal_id, owner_id, tenant_id in rows:
        tags = bind.execute(
            sa.text(
                "SELECT tag_id FROM project_tag_links WHERE project_id = :p"
            ),
            {"p": owner_id},
        ).fetchall()
        for (tag_id,) in tags:
            exists = bind.execute(
                sa.text(
                    "SELECT 1 FROM signal_tag_links "
                    "WHERE signal_id = :s AND tag_id = :t"
                ),
                {"s": signal_id, "t": tag_id},
            ).scalar()
            if exists:
                continue
            bind.execute(
                sa.text(
                    "INSERT INTO signal_tag_links "
                    "(signal_id, tag_id, tenant_id, created_at) "
                    "VALUES (:s, :t, :tenant, :now)"
                ),
                {"s": signal_id, "t": tag_id, "tenant": tenant_id, "now": now},
            )
        bind.execute(
            sa.text(
                "UPDATE signals SET project_id = :p WHERE id = :s AND project_id IS NULL"
            ),
            {"p": owner_id, "s": signal_id},
        )


def upgrade() -> None:
    bind = op.get_bind()
    cols = _columns(bind, "project_canvases")
    if "owner_id" not in cols:
        if "uq_canvas_signal_slug_alive" not in _indexes(bind, "project_canvases"):
            op.create_index(
                "uq_canvas_signal_slug_alive",
                "project_canvases",
                ["tenant_id", "signal_id", "slug"],
                unique=True,
                postgresql_where=sa.text("deleted_at IS NULL"),
                sqlite_where=sa.text("deleted_at IS NULL"),
            )
        if "signal_id" in cols:
            op.alter_column(
                "project_canvases",
                "signal_id",
                existing_type=sa.Uuid(),
                nullable=False,
            )
        return

    op.execute(sa.text("DELETE FROM project_canvases WHERE kind = 'brand'"))
    op.execute(sa.text("DELETE FROM project_canvases WHERE signal_id IS NULL"))
    _file_threads_into_owner_folders(bind)

    indexes = _indexes(bind, "project_canvases")
    for name in (
        "uq_canvas_owner_slug_alive",
        "uq_canvas_owner_slug",
        "ix_project_canvases_owner_kind",
        "ix_project_canvases_owner_id",
        "ix_project_canvases_project_id",
    ):
        if name in indexes:
            op.drop_index(name, table_name="project_canvases")

    cols = _columns(bind, "project_canvases")
    for col in ("owner_kind", "owner_id", "project_id"):
        if col in cols:
            op.drop_column("project_canvases", col)

    op.alter_column(
        "project_canvases",
        "signal_id",
        existing_type=sa.Uuid(),
        nullable=False,
    )

    if "uq_canvas_signal_slug_alive" not in _indexes(bind, "project_canvases"):
        op.create_index(
            "uq_canvas_signal_slug_alive",
            "project_canvases",
            ["tenant_id", "signal_id", "slug"],
            unique=True,
            postgresql_where=sa.text("deleted_at IS NULL"),
            sqlite_where=sa.text("deleted_at IS NULL"),
        )


def downgrade() -> None:
    bind = op.get_bind()
    indexes = _indexes(bind, "project_canvases")
    if "uq_canvas_signal_slug_alive" in indexes:
        op.drop_index("uq_canvas_signal_slug_alive", table_name="project_canvases")

    op.alter_column(
        "project_canvases",
        "signal_id",
        existing_type=sa.Uuid(),
        nullable=True,
    )

    cols = _columns(bind, "project_canvases")
    if "owner_kind" not in cols:
        op.add_column(
            "project_canvases",
            sa.Column(
                "owner_kind",
                sa.String(length=16),
                nullable=False,
                server_default="project",
            ),
        )
    if "owner_id" not in cols:
        op.add_column(
            "project_canvases",
            sa.Column("owner_id", sa.Uuid(), nullable=True),
        )
    if "project_id" not in cols:
        op.add_column(
            "project_canvases",
            sa.Column("project_id", sa.Uuid(), nullable=True),
        )

    # Backfill owner from the home thread's folder, else General/Algemeen.
    bind.execute(
        sa.text(
            """
            UPDATE project_canvases c
            SET owner_kind = 'project',
                owner_id = COALESCE(
                    (SELECT s.project_id FROM signals s WHERE s.id = c.signal_id),
                    (
                        SELECT p.id FROM projects p
                        WHERE p.tenant_id = c.tenant_id
                          AND p.deleted_at IS NULL
                          AND p.name IN ('Algemeen', 'General')
                        ORDER BY p.created_at
                        LIMIT 1
                    )
                ),
                project_id = COALESCE(
                    (SELECT s.project_id FROM signals s WHERE s.id = c.signal_id),
                    (
                        SELECT p.id FROM projects p
                        WHERE p.tenant_id = c.tenant_id
                          AND p.deleted_at IS NULL
                          AND p.name IN ('Algemeen', 'General')
                        ORDER BY p.created_at
                        LIMIT 1
                    )
                )
            """
        )
    )
    # Drop rows that still have no folder (cannot restore owner_id NOT NULL).
    bind.execute(sa.text("DELETE FROM project_canvases WHERE owner_id IS NULL"))
    op.alter_column("project_canvases", "owner_id", existing_type=sa.Uuid(), nullable=False)

    op.create_index(
        "uq_canvas_owner_slug_alive",
        "project_canvases",
        ["tenant_id", "owner_kind", "owner_id", "slug"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL"),
        sqlite_where=sa.text("deleted_at IS NULL"),
    )
