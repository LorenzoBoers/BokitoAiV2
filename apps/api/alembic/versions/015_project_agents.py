"""Add project_agents (agent roster per project, with a default for threads).

Revision ID: 015_project_agents
Revises: 014_agent_is_lead
"""

import sqlalchemy as sa
from alembic import op

revision = "015_project_agents"
down_revision = "014_agent_is_lead"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("project_agents"):
        return
    op.create_table(
        "project_agents",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("project_id", sa.Uuid(), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("agent_id", sa.Uuid(), sa.ForeignKey("agents.id"), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("project_id", "agent_id", name="uq_project_agent"),
    )
    op.create_index("ix_project_agents_tenant_id", "project_agents", ["tenant_id"])
    op.create_index("ix_project_agents_project_id", "project_agents", ["project_id"])
    op.create_index("ix_project_agents_agent_id", "project_agents", ["agent_id"])


def downgrade() -> None:
    op.drop_table("project_agents")
