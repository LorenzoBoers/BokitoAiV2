"""A flow can name where its work is delivered.

Revision ID: 127_flow_destination
Revises: 126_general_folder

``workstreams.deliver_folder_id`` points at a folder; ``deliver_works_in_key``
names one of its Works in items (empty means the folder itself). Both start
empty, so the upgrade changes no values.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "127_flow_destination"
down_revision = "126_general_folder"
branch_labels = None
depends_on = None


def _columns(bind) -> set[str]:
    inspector = sa.inspect(bind)
    if "workstreams" not in set(inspector.get_table_names()):
        return set()
    return {column["name"] for column in inspector.get_columns("workstreams")}


def upgrade() -> None:
    bind = op.get_bind()
    columns = _columns(bind)
    if not columns:
        return
    if "deliver_folder_id" not in columns:
        op.add_column("workstreams", sa.Column("deliver_folder_id", sa.Uuid(), nullable=True))
        if bind.dialect.name != "sqlite":
            op.create_foreign_key(
                "fk_workstreams_deliver_folder", "workstreams", "projects", ["deliver_folder_id"], ["id"], ondelete="SET NULL"
            )
        op.create_index("ix_workstreams_deliver_folder_id", "workstreams", ["deliver_folder_id"])
    if "deliver_works_in_key" not in columns:
        op.add_column(
            "workstreams",
            sa.Column("deliver_works_in_key", sa.String(length=80), nullable=False, server_default=""),
        )


def downgrade() -> None:
    bind = op.get_bind()
    columns = _columns(bind)
    if "deliver_works_in_key" in columns:
        op.drop_column("workstreams", "deliver_works_in_key")
    if "deliver_folder_id" in columns:
        op.drop_index("ix_workstreams_deliver_folder_id", table_name="workstreams")
        if bind.dialect.name != "sqlite":
            op.drop_constraint("fk_workstreams_deliver_folder", "workstreams", type_="foreignkey")
        op.drop_column("workstreams", "deliver_folder_id")
