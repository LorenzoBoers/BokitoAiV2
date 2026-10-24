"""Intercom voice notes per person.

Revision ID: 156_voice_notes
Revises: 155_call_voice_holder
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "156_voice_notes"
down_revision = "155_call_voice_holder"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if sa.inspect(bind).has_table("voice_notes"):
        return
    op.create_table(
        "voice_notes",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("agent_id", sa.Uuid(), sa.ForeignKey("agents.id"), nullable=True),
        sa.Column("signal_id", sa.Uuid(), sa.ForeignKey("signals.id", ondelete="SET NULL"), nullable=True),
        sa.Column("message_id", sa.Uuid(), nullable=True),
        sa.Column("kind", sa.String(length=16), nullable=False, server_default="result"),
        sa.Column("text", sa.Text(), nullable=False, server_default=""),
        sa.Column("storage_key", sa.String(length=400), nullable=False, server_default=""),
        sa.Column("duration_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="queued"),
        sa.Column("reply_to_id", sa.Uuid(), nullable=True),
        sa.Column("via_agent_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("played_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_voice_notes_tenant_id", "voice_notes", ["tenant_id"])
    op.create_index("ix_voice_notes_user_status", "voice_notes", ["user_id", "status"])
    op.create_index("ix_voice_notes_agent_id", "voice_notes", ["agent_id"])
    op.create_index("ix_voice_notes_signal_id", "voice_notes", ["signal_id"])
    op.create_index("ix_voice_notes_message_id", "voice_notes", ["message_id"])
    op.create_index("ix_voice_notes_created_at", "voice_notes", ["created_at"])


def downgrade() -> None:
    bind = op.get_bind()
    if not sa.inspect(bind).has_table("voice_notes"):
        return
    op.drop_table("voice_notes")
