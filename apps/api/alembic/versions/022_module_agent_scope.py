"""Module agent scope: per-agent company scope + write flag.

Revision ID: 022_module_agent_scope
Revises: 021_module_agents
"""

import sqlalchemy as sa
from alembic import op

revision = "022_module_agent_scope"
down_revision = "021_module_agents"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {c["name"] for c in inspector.get_columns("module_agents")}
    if "company_ids_json" not in columns:
        op.add_column(
            "module_agents",
            sa.Column("company_ids_json", sa.String(), nullable=False, server_default=""),
        )
    if "can_write" not in columns:
        op.add_column(
            "module_agents",
            sa.Column("can_write", sa.Boolean(), nullable=False, server_default=sa.false()),
        )


def downgrade() -> None:
    op.drop_column("module_agents", "can_write")
    op.drop_column("module_agents", "company_ids_json")
