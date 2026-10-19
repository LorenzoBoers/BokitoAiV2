"""In-app agent calls while a decision card is open.

Revision ID: 117_agent_calls
Revises: 116_module_one_time_drop
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "117_agent_calls"
down_revision = "116_module_one_time_drop"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "agent_calls" in inspector.get_table_names():
        return
    op.create_table(
        "agent_calls",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("signal_id", sa.Uuid(), nullable=False),
        sa.Column("agent_id", sa.Uuid(), nullable=True),
        sa.Column("decision_id", sa.Uuid(), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=True),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("ring_until", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("answered_at", sa.DateTime(), nullable=True),
        sa.Column("ended_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["agent_id"], ["agents.id"]),
        sa.ForeignKeyConstraint(["signal_id"], ["signals.id"]),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_agent_calls_tenant_id", "agent_calls", ["tenant_id"])
    op.create_index("ix_agent_calls_signal_id", "agent_calls", ["signal_id"])
    op.create_index("ix_agent_calls_agent_id", "agent_calls", ["agent_id"])
    op.create_index("ix_agent_calls_decision_id", "agent_calls", ["decision_id"])
    op.create_index("ix_agent_calls_run_id", "agent_calls", ["run_id"])
    op.create_index("ix_agent_calls_user_id", "agent_calls", ["user_id"])
    op.create_index("ix_agent_calls_status", "agent_calls", ["status"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "agent_calls" not in inspector.get_table_names():
        return
    op.drop_index("ix_agent_calls_status", table_name="agent_calls")
    op.drop_index("ix_agent_calls_user_id", table_name="agent_calls")
    op.drop_index("ix_agent_calls_run_id", table_name="agent_calls")
    op.drop_index("ix_agent_calls_decision_id", table_name="agent_calls")
    op.drop_index("ix_agent_calls_agent_id", table_name="agent_calls")
    op.drop_index("ix_agent_calls_signal_id", table_name="agent_calls")
    op.drop_index("ix_agent_calls_tenant_id", table_name="agent_calls")
    op.drop_table("agent_calls")
