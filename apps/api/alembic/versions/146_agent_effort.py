"""Agent effort (low | medium | high) replaces the thinking token budget.

Revision ID: 146_agent_effort
Revises: 145_debug_dom
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "146_agent_effort"
down_revision = "145_debug_dom"
branch_labels = None
depends_on = None

BUDGET_TO_EFFORT_SQL = (
    "CASE WHEN thinking_budget IS NULL OR thinking_budget <= 0 THEN 'medium' "
    "WHEN thinking_budget <= 2048 THEN 'low' "
    "WHEN thinking_budget <= 8192 THEN 'medium' "
    "ELSE 'high' END"
)


def _columns(bind) -> set[str]:
    return {col["name"] for col in sa.inspect(bind).get_columns("agents")}


def upgrade() -> None:
    bind = op.get_bind()
    columns = _columns(bind)
    if "effort" not in columns:
        op.add_column(
            "agents",
            sa.Column("effort", sa.String(length=12), nullable=False, server_default="medium"),
        )
    if "thinking_budget" in columns:
        op.execute(f"UPDATE agents SET effort = {BUDGET_TO_EFFORT_SQL}")
        op.drop_column("agents", "thinking_budget")


def downgrade() -> None:
    bind = op.get_bind()
    columns = _columns(bind)
    if "thinking_budget" not in columns:
        op.add_column(
            "agents",
            sa.Column("thinking_budget", sa.Integer(), nullable=False, server_default="0"),
        )
    if "effort" in columns:
        op.execute(
            "UPDATE agents SET thinking_budget = CASE effort "
            "WHEN 'low' THEN 1024 WHEN 'high' THEN 12000 ELSE 4096 END"
        )
        op.drop_column("agents", "effort")
