"""Hot indexes for Communication list/badge queries.

Revision ID: 053_signal_hot_indexes
Revises: 052_agent_managed_provenance
"""

import sqlalchemy as sa
from alembic import op

revision = "053_signal_hot_indexes"
down_revision = "052_agent_managed_provenance"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing = {idx["name"] for idx in inspector.get_indexes("signals")}
    msg_existing = {idx["name"] for idx in inspector.get_indexes("signal_messages")}

    if "ix_signals_tenant_status_last_message" not in existing:
        op.create_index(
            "ix_signals_tenant_status_last_message",
            "signals",
            ["tenant_id", "status", "last_message_at"],
        )
    if "ix_signals_tenant_unread_status" not in existing:
        op.create_index(
            "ix_signals_tenant_unread_status",
            "signals",
            ["tenant_id", "has_unread", "status"],
        )
    if "ix_signals_tenant_assignee_status" not in existing:
        op.create_index(
            "ix_signals_tenant_assignee_status",
            "signals",
            ["tenant_id", "assigned_user_id", "status"],
        )
    if "ix_signal_messages_signal_created" not in msg_existing:
        op.create_index(
            "ix_signal_messages_signal_created",
            "signal_messages",
            ["signal_id", "created_at"],
        )


def downgrade() -> None:
    op.drop_index("ix_signal_messages_signal_created", table_name="signal_messages")
    op.drop_index("ix_signals_tenant_assignee_status", table_name="signals")
    op.drop_index("ix_signals_tenant_unread_status", table_name="signals")
    op.drop_index("ix_signals_tenant_status_last_message", table_name="signals")
