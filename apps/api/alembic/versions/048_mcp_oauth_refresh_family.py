"""Refresh-token family_id for MCP OAuth reuse detection.

Revision ID: 048_mcp_oauth_refresh_family
Revises: 047_mcp_oauth_as
"""

import sqlalchemy as sa
from alembic import op

revision = "048_mcp_oauth_refresh_family"
down_revision = "047_mcp_oauth_as"
branch_labels = None
depends_on = None


def _columns(conn, table: str) -> set[str]:
    inspector = sa.inspect(conn)
    if table not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(table)}


def _indexes(conn, table: str) -> set[str]:
    inspector = sa.inspect(conn)
    if table not in inspector.get_table_names():
        return set()
    return {i["name"] for i in inspector.get_indexes(table) if i.get("name")}


def upgrade() -> None:
    conn = op.get_bind()
    if "mcp_oauth_refresh_tokens" not in sa.inspect(conn).get_table_names():
        return
    if "family_id" not in _columns(conn, "mcp_oauth_refresh_tokens"):
        op.add_column(
            "mcp_oauth_refresh_tokens",
            sa.Column("family_id", sa.Uuid(), nullable=True),
        )
        op.execute(
            "UPDATE mcp_oauth_refresh_tokens SET family_id = id WHERE family_id IS NULL"
        )
        # SQLite/Postgres: make non-null after backfill when dialect allows.
        try:
            op.alter_column(
                "mcp_oauth_refresh_tokens",
                "family_id",
                existing_type=sa.Uuid(),
                nullable=False,
            )
        except Exception:
            pass
    if "ix_mcp_oauth_refresh_tokens_family_id" not in _indexes(
        conn, "mcp_oauth_refresh_tokens"
    ):
        op.create_index(
            "ix_mcp_oauth_refresh_tokens_family_id",
            "mcp_oauth_refresh_tokens",
            ["family_id"],
        )


def downgrade() -> None:
    conn = op.get_bind()
    if "ix_mcp_oauth_refresh_tokens_family_id" in _indexes(
        conn, "mcp_oauth_refresh_tokens"
    ):
        op.drop_index(
            "ix_mcp_oauth_refresh_tokens_family_id",
            table_name="mcp_oauth_refresh_tokens",
        )
    if "family_id" in _columns(conn, "mcp_oauth_refresh_tokens"):
        op.drop_column("mcp_oauth_refresh_tokens", "family_id")
