"""Voice mode does not need a decision card.

Revision ID: 154_voice_mode_call
Revises: 153_one_open_call
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "154_voice_mode_call"
down_revision = "153_one_open_call"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("agent_calls"):
        return
    columns = {col["name"]: col for col in inspector.get_columns("agent_calls")}
    decision = columns.get("decision_id")
    if decision is not None and not decision.get("nullable", False):
        op.alter_column("agent_calls", "decision_id", existing_type=sa.Uuid(), nullable=True)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("agent_calls"):
        return
    op.execute(
        sa.text(
            "UPDATE agent_calls SET status = 'ended', ended_at = CURRENT_TIMESTAMP "
            "WHERE decision_id IS NULL AND status IN ('ringing', 'live')"
        )
    )
    op.execute(sa.text("DELETE FROM agent_calls WHERE decision_id IS NULL"))
    columns = {col["name"]: col for col in inspector.get_columns("agent_calls")}
    decision = columns.get("decision_id")
    if decision is not None and decision.get("nullable", True):
        op.alter_column("agent_calls", "decision_id", existing_type=sa.Uuid(), nullable=False)
