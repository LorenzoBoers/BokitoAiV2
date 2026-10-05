"""Agent.last_active_at and deactivate seeded mock:// MCP servers.

Revision ID: 061_agent_last_active_mock_mcp
Revises: 060_membership_is_active
"""

import sqlalchemy as sa
from alembic import op

revision = "061_agent_last_active_mock_mcp"
down_revision = "060_membership_is_active"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "agents" in tables:
        columns = {col["name"] for col in inspector.get_columns("agents")}
        if "last_active_at" not in columns:
            op.add_column("agents", sa.Column("last_active_at", sa.DateTime(), nullable=True))
        if "agent_runs" in tables:
            op.execute(
                """
                UPDATE agents SET last_active_at = (
                    SELECT MAX(COALESCE(r.completed_at, r.started_at))
                    FROM agent_runs r WHERE r.agent_id = agents.id
                )
                """
            )
    from app.config import get_settings

    if "mcp_servers" in tables and get_settings().is_production:
        # Demo seed rows (mock://local) have no tools and confuse agents in prod.
        op.execute("UPDATE mcp_servers SET is_active = false WHERE server_url LIKE 'mock://%'")
        if "integration_connections" in tables:
            op.execute(
                "UPDATE integration_connections SET status = 'revoked' "
                "WHERE metadata_json LIKE '%\"server_url\": \"mock://%'"
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "agents" not in set(inspector.get_table_names()):
        return
    columns = {col["name"] for col in inspector.get_columns("agents")}
    if "last_active_at" in columns:
        op.drop_column("agents", "last_active_at")
