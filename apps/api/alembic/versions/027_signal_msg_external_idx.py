"""Composite index for signal message external_id dedupe lookups.

Revision ID: 027_signal_msg_external_idx
Revises: 026_module_connection_attach
"""

from alembic import op

revision = "027_signal_msg_external_idx"
down_revision = "026_module_connection_attach"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "ix_signal_messages_tenant_external",
        "signal_messages",
        ["tenant_id", "external_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_signal_messages_tenant_external", table_name="signal_messages")
