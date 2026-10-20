"""Drop hidden decision-outcome hint messages.

A resolved card now tells the agent its own outcome (the card row is the log)
and the wake carries the outcome as its brief. The fake operator messages that
used to carry it are deleted.

Revision ID: 134_drop_decision_hints
Revises: 133_drop_turn_checkpoints
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "134_drop_decision_hints"
down_revision = "133_drop_turn_checkpoints"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    ids = bind.execute(
        sa.text(
            "SELECT id FROM signal_messages WHERE metadata_json LIKE '%\"decision_outcome_hint\": true%'"
        )
    ).scalars().all()
    for row_id in ids:
        try:
            with bind.begin_nested():
                bind.execute(sa.text("DELETE FROM signal_messages WHERE id = :id"), {"id": row_id})
        except sa.exc.IntegrityError:
            pass


def downgrade() -> None:
    pass
