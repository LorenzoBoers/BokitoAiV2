"""Add agents.is_lead (exactly one lead company agent per tenant).

Revision ID: 014_agent_is_lead
Revises: 013_agent_settings_json

The lead agent is the tenant-wide default fallback for routing, triggers and
orchestration. The data backfill (promote the oldest active company assistant
per tenant) runs at startup via `lead_agent.ensure_lead_agents`.
"""

import sqlalchemy as sa
from alembic import op

revision = "014_agent_is_lead"
down_revision = "013_agent_settings_json"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {c["name"] for c in inspector.get_columns("agents")}
    if "is_lead" not in columns:
        op.add_column(
            "agents",
            sa.Column("is_lead", sa.Boolean(), nullable=False, server_default=sa.false()),
        )
        op.create_index("ix_agents_is_lead", "agents", ["is_lead"])


def downgrade() -> None:
    op.drop_index("ix_agents_is_lead", table_name="agents")
    op.drop_column("agents", "is_lead")
