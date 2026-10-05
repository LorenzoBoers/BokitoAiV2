"""Agent.current_signal_id — conversation the agent is working on.

Revision ID: 068_agent_current_signal
Revises: 067_drop_project_autonomous_mode
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "068_agent_current_signal"
down_revision = "067_drop_project_autonomous_mode"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "agents" not in set(inspector.get_table_names()):
        return
    cols = {c["name"] for c in inspector.get_columns("agents")}
    if "current_signal_id" not in cols:
        op.add_column("agents", sa.Column("current_signal_id", sa.Uuid(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "agents" not in set(inspector.get_table_names()):
        return
    cols = {c["name"] for c in inspector.get_columns("agents")}
    if "current_signal_id" in cols:
        op.drop_column("agents", "current_signal_id")
