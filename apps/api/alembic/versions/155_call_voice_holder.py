"""One browser tab holds a live voice line.

Revision ID: 155_call_voice_holder
Revises: 154_voice_mode_call
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "155_call_voice_holder"
down_revision = "154_voice_mode_call"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("agent_calls"):
        return
    columns = {col["name"] for col in inspector.get_columns("agent_calls")}
    if "voice_client" not in columns:
        op.add_column(
            "agent_calls",
            sa.Column("voice_client", sa.String(length=80), nullable=False, server_default=""),
        )
    if "voice_seen_at" not in columns:
        op.add_column("agent_calls", sa.Column("voice_seen_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("agent_calls"):
        return
    columns = {col["name"] for col in inspector.get_columns("agent_calls")}
    if "voice_seen_at" in columns:
        op.drop_column("agent_calls", "voice_seen_at")
    if "voice_client" in columns:
        op.drop_column("agent_calls", "voice_client")
