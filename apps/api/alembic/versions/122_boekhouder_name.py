"""Rename module agents that are still called Boekito.

Revision ID: 122_boekhouder_name
Revises: 121_flow_stage_names

Only the exact catalog name changes. A workspace that already renamed the
agent keeps that name.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "122_boekhouder_name"
down_revision = "121_flow_stage_names"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "agents" not in inspector.get_table_names():
        return
    bind.execute(sa.text("UPDATE agents SET name = 'Boekhouder' WHERE name = 'Boekito'"))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "agents" not in inspector.get_table_names():
        return
    bind.execute(
        sa.text(
            "UPDATE agents SET name = 'Boekito' WHERE name = 'Boekhouder' AND slug = 'module-accounting'"
        )
    )
