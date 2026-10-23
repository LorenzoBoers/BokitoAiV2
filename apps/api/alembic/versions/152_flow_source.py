"""Store the flow notation (steps and arrows) on the flow.

Revision ID: 152_flow_source
Revises: 151_ambient_availability
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "152_flow_source"
down_revision = "151_ambient_availability"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("workstreams")} if inspector.has_table("workstreams") else set()
    if "flow_source" not in columns:
        op.add_column("workstreams", sa.Column("flow_source", sa.Text(), nullable=False, server_default=""))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("workstreams")} if inspector.has_table("workstreams") else set()
    if "flow_source" in columns:
        op.drop_column("workstreams", "flow_source")
