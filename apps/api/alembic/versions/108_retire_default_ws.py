"""Soft-delete internal Review-and-execute project defaults.

Revision ID: 108_retire_default_ws
Revises: 107_drop_tag_groups

Untagged "Review and execute" playbooks were auto-created per folder as a
queue-routing fallback. Operator Flows are action-tag playbooks only; the
internal default is retired. Soft-delete surviving copies and drop their
folder links. Tagged Flows with the same name (if any) are left alone.
"""

from __future__ import annotations

from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision = "108_retire_default_ws"
down_revision = "107_drop_tag_groups"
branch_labels = None
depends_on = None

DEFAULT_NAME = "Review and execute"


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    if "workstreams" not in tables:
        return

    if "signal_tags" in tables:
        id_sql = (
            "SELECT w.id FROM workstreams w "
            "WHERE w.name = :name AND w.deleted_at IS NULL "
            "AND NOT EXISTS ("
            "  SELECT 1 FROM signal_tags t WHERE t.workstream_id = w.id"
            ")"
        )
    else:
        id_sql = (
            "SELECT w.id FROM workstreams w "
            "WHERE w.name = :name AND w.deleted_at IS NULL"
        )

    ids = [row[0] for row in bind.execute(sa.text(id_sql), {"name": DEFAULT_NAME})]
    if not ids:
        return

    if "workstream_projects" in tables:
        for ws_id in ids:
            bind.execute(
                sa.text("DELETE FROM workstream_projects WHERE workstream_id = :id"),
                {"id": ws_id},
            )

    now = datetime.utcnow()
    for ws_id in ids:
        bind.execute(
            sa.text(
                "UPDATE workstreams SET deleted_at = :now, updated_at = :now "
                "WHERE id = :id AND deleted_at IS NULL"
            ),
            {"id": ws_id, "now": now},
        )


def downgrade() -> None:
    # Soft-deleted defaults are not recreated; folders no longer auto-link them.
    pass
