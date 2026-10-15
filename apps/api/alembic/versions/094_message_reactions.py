"""Message reactions: LinkedIn-style stack on timeline messages.

Revision ID: 094_message_reactions
Revises: 093_agent_unique_name
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "094_message_reactions"
down_revision = "093_agent_unique_name"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("message_reactions"):
        return
    op.create_table(
        "message_reactions",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("signal_id", sa.Uuid(), sa.ForeignKey("signals.id"), nullable=False),
        sa.Column(
            "message_id", sa.Uuid(), sa.ForeignKey("signal_messages.id"), nullable=False
        ),
        sa.Column("kind", sa.String(length=32), nullable=False, server_default="up"),
        sa.Column("actor_type", sa.String(length=16), nullable=False, server_default="user"),
        sa.Column("actor_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint(
            "tenant_id",
            "message_id",
            "actor_type",
            "actor_id",
            name="uq_message_reactions_actor",
        ),
    )
    op.create_index("ix_message_reactions_tenant_id", "message_reactions", ["tenant_id"])
    op.create_index("ix_message_reactions_signal_id", "message_reactions", ["signal_id"])
    op.create_index("ix_message_reactions_message_id", "message_reactions", ["message_id"])
    op.create_index("ix_message_reactions_kind", "message_reactions", ["kind"])
    op.create_index("ix_message_reactions_message", "message_reactions", ["message_id"])
    op.create_index("ix_message_reactions_signal", "message_reactions", ["signal_id"])


def downgrade() -> None:
    op.drop_table("message_reactions")
