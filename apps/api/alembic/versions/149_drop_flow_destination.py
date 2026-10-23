"""Drop the flow "Delivers to" folder.

A done stage no longer writes a delivery from a folder stored on the flow.
Results an agent actually placed (a reply, a connection write, knowledge)
still record their own delivered event. Existing events keep their payload.

Revision ID: 149_drop_flow_destination
Revises: 148_boekito_name
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "149_drop_flow_destination"
down_revision = "148_boekito_name"
branch_labels = None
depends_on = None


def _drop_deliver_fk(inspector) -> None:
    for fk in inspector.get_foreign_keys("workstreams"):
        cols = fk.get("constrained_columns") or []
        if "deliver_folder_id" in cols and fk.get("name"):
            with op.batch_alter_table("workstreams") as batch:
                batch.drop_constraint(fk["name"], type_="foreignkey")


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "workstreams" not in inspector.get_table_names():
        return
    _drop_deliver_fk(inspector)
    for idx in inspector.get_indexes("workstreams"):
        cols = idx.get("column_names") or []
        if idx.get("name") and "deliver_folder_id" in cols:
            op.drop_index(idx["name"], table_name="workstreams")
    columns = {col["name"] for col in inspector.get_columns("workstreams")}
    with op.batch_alter_table("workstreams") as batch:
        if "deliver_works_in_key" in columns:
            batch.drop_column("deliver_works_in_key")
        if "deliver_folder_id" in columns:
            batch.drop_column("deliver_folder_id")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "workstreams" not in inspector.get_table_names():
        return
    columns = {col["name"] for col in inspector.get_columns("workstreams")}
    with op.batch_alter_table("workstreams") as batch:
        if "deliver_folder_id" not in columns:
            batch.add_column(sa.Column("deliver_folder_id", sa.Uuid(), nullable=True))
        if "deliver_works_in_key" not in columns:
            batch.add_column(
                sa.Column("deliver_works_in_key", sa.String(length=80), nullable=False, server_default="")
            )
    op.create_index("ix_workstreams_deliver_folder_id", "workstreams", ["deliver_folder_id"])
