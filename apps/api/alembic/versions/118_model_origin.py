"""Mark seeded Bokito provider and model rows as platform origin.

Revision ID: 118_model_origin
Revises: 117_agent_calls
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "118_model_origin"
down_revision = "117_agent_calls"
branch_labels = None
depends_on = None


def _add_origin(table: str) -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if table not in inspector.get_table_names():
        return
    columns = {col["name"] for col in inspector.get_columns(table)}
    if "origin" in columns:
        return
    op.add_column(
        table,
        sa.Column("origin", sa.String(), nullable=False, server_default="tenant"),
    )


def upgrade() -> None:
    _add_origin("provider_connections")
    _add_origin("tenant_models")


def downgrade() -> None:
    op.drop_column("tenant_models", "origin")
    op.drop_column("provider_connections", "origin")
