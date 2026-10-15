"""Active multi-agent turn floor on conversations.

Revision ID: 097_signal_active_turn
Revises: 096_signal_participants
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "097_signal_active_turn"
down_revision = "096_signal_participants"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = {c["name"] for c in inspector.get_columns("signals")} if inspector.has_table("signals") else set()
    if "active_turn_json" not in cols:
        op.add_column(
            "signals",
            sa.Column("active_turn_json", sa.Text(), nullable=False, server_default="{}"),
        )


def downgrade() -> None:
    op.drop_column("signals", "active_turn_json")
