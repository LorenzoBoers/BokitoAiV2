"""A second intent in a conversation is split into its own conversation.

- ``signals.parent_signal_id``: the conversation this one was split from
- ``signals.superseded_by_id``: the newer conversation inbound replies on the
  same provider thread now land in

Revision ID: 072_conversation_split
Revises: 071_ticket_stages
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "072_conversation_split"
down_revision = "071_ticket_stages"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("signals")}
    with op.batch_alter_table("signals") as batch:
        if "parent_signal_id" not in columns:
            batch.add_column(sa.Column("parent_signal_id", sa.Uuid(), nullable=True))
            batch.create_index("ix_signals_parent_signal_id", ["parent_signal_id"])
        if "superseded_by_id" not in columns:
            batch.add_column(sa.Column("superseded_by_id", sa.Uuid(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("signals") as batch:
        batch.drop_column("superseded_by_id")
        batch.drop_index("ix_signals_parent_signal_id")
        batch.drop_column("parent_signal_id")
