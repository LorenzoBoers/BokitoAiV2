"""Agent turns: the queue of who speaks next in a conversation.

Revision ID: 129_agent_turns
Revises: 128_message_seq

One row per turn. A partial unique index keeps one running turn per
conversation; ``idempotency_key`` makes every enqueue safe to repeat.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "129_agent_turns"
down_revision = "128_message_seq"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if "agent_turns" in sa.inspect(bind).get_table_names():
        return
    op.create_table(
        "agent_turns",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("signal_id", sa.Uuid(), sa.ForeignKey("signals.id"), nullable=False),
        sa.Column("agent_id", sa.Uuid(), sa.ForeignKey("agents.id"), nullable=False),
        sa.Column("cause_kind", sa.String(), nullable=False, server_default="human"),
        sa.Column("cause_message_id", sa.Uuid(), nullable=True),
        sa.Column("requested_by_kind", sa.String(), nullable=False, server_default="user"),
        sa.Column("requested_by_id", sa.Uuid(), nullable=True),
        sa.Column("prompt", sa.Text(), nullable=False, server_default=""),
        sa.Column("ask_id", sa.Uuid(), nullable=True),
        sa.Column("episode_id", sa.Uuid(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="queued"),
        sa.Column("outcome", sa.String(), nullable=False, server_default=""),
        sa.Column("lease_until", sa.DateTime(), nullable=True),
        sa.Column("attempt", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("run_id", sa.Uuid(), nullable=True),
        sa.Column("tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("idempotency_key", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("idempotency_key", name="uq_agent_turns_idempotency_key"),
    )
    op.create_index("ix_agent_turns_tenant_id", "agent_turns", ["tenant_id"])
    op.create_index("ix_agent_turns_signal_id", "agent_turns", ["signal_id"])
    op.create_index("ix_agent_turns_agent_id", "agent_turns", ["agent_id"])
    op.create_index("ix_agent_turns_episode_id", "agent_turns", ["episode_id"])
    op.create_index("ix_agent_turns_status", "agent_turns", ["status"])
    op.create_index("ix_agent_turns_signal_status", "agent_turns", ["signal_id", "status"])
    op.create_index(
        "ux_agent_turns_one_running",
        "agent_turns",
        ["signal_id"],
        unique=True,
        postgresql_where=sa.text("status = 'running'"),
    )


def downgrade() -> None:
    bind = op.get_bind()
    if "agent_turns" in sa.inspect(bind).get_table_names():
        op.drop_table("agent_turns")
