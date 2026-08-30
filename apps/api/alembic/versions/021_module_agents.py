"""Add module_agents (agent roster per business module, with a default).

Revision ID: 021_module_agents
Revises: 020_calendar_events
"""

import sqlalchemy as sa
from alembic import op

revision = "021_module_agents"
down_revision = "020_calendar_events"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("module_agents"):
        return
    op.create_table(
        "module_agents",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("module_slug", sa.String(length=64), nullable=False),
        sa.Column("agent_id", sa.Uuid(), sa.ForeignKey("agents.id"), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("tenant_id", "module_slug", "agent_id", name="uq_module_agent"),
    )
    op.create_index("ix_module_agents_tenant_id", "module_agents", ["tenant_id"])
    op.create_index("ix_module_agents_module_slug", "module_agents", ["module_slug"])
    op.create_index("ix_module_agents_agent_id", "module_agents", ["agent_id"])


def downgrade() -> None:
    op.drop_table("module_agents")
