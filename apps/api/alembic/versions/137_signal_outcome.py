"""Signal outcome: what the latest closed episode delivered.

- ``signals.outcome_json``: summary written when a conversation closes.

Revision ID: 137_signal_outcome
Revises: 136_ticket_work
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "137_signal_outcome"
down_revision = "136_ticket_work"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if "signals" not in sa.inspect(bind).get_table_names():
        return
    present = {c["name"] for c in sa.inspect(bind).get_columns("signals")}
    if "outcome_json" not in present:
        op.add_column("signals", sa.Column("outcome_json", sa.Text(), nullable=False, server_default="{}"))


def downgrade() -> None:
    bind = op.get_bind()
    if "signals" not in sa.inspect(bind).get_table_names():
        return
    present = {c["name"] for c in sa.inspect(bind).get_columns("signals")}
    if "outcome_json" in present:
        op.drop_column("signals", "outcome_json")
