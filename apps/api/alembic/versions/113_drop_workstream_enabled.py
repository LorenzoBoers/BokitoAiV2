"""Drop Workstream.enabled and trash_was_enabled.

Revision ID: 113_drop_workstream_enabled
Revises: 112_department_home_and_all_root

A flow is live when a label is linked to it. There is no separate
active/deactivated flag.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "113_drop_workstream_enabled"
down_revision = "112_department_home_and_all_root"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "workstreams" not in inspector.get_table_names():
        return
    columns = {c["name"] for c in inspector.get_columns("workstreams")}
    if "trash_was_enabled" in columns:
        op.drop_column("workstreams", "trash_was_enabled")
    if "enabled" in columns:
        op.drop_column("workstreams", "enabled")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "workstreams" not in inspector.get_table_names():
        return
    columns = {c["name"] for c in inspector.get_columns("workstreams")}
    if "enabled" not in columns:
        op.add_column(
            "workstreams",
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        )
    if "trash_was_enabled" not in columns:
        op.add_column(
            "workstreams",
            sa.Column("trash_was_enabled", sa.Boolean(), nullable=True),
        )
