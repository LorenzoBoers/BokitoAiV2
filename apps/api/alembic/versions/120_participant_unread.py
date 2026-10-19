"""Unread count per human participant.

Revision ID: 120_participant_unread
Revises: 119_workforce_member_type

A person in a conversation keeps their own unread count, like a group chat.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "120_participant_unread"
down_revision = "119_workforce_member_type"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "signal_participants" not in inspector.get_table_names():
        return
    columns = {col["name"] for col in inspector.get_columns("signal_participants")}
    if "unread_count" in columns:
        return
    op.add_column(
        "signal_participants",
        sa.Column("unread_count", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "signal_participants" not in inspector.get_table_names():
        return
    columns = {col["name"] for col in inspector.get_columns("signal_participants")}
    if "unread_count" not in columns:
        return
    op.drop_column("signal_participants", "unread_count")
