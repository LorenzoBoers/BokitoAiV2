"""OAuth AS tables for workspace MCP (URL-only Cursor connect).

Revision ID: 047_mcp_oauth_as
Revises: 046_signal_follow_up
"""

import sqlalchemy as sa
from alembic import op

revision = "047_mcp_oauth_as"
down_revision = "046_signal_follow_up"
branch_labels = None
depends_on = None


def _tables(conn) -> set[str]:
    return set(sa.inspect(conn).get_table_names())


def upgrade() -> None:
    conn = op.get_bind()
    existing = _tables(conn)

    if "mcp_oauth_clients" not in existing:
        op.create_table(
            "mcp_oauth_clients",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("client_id", sa.String(), nullable=False),
            sa.Column("client_secret_hash", sa.String(), nullable=True),
            sa.Column("client_name", sa.String(), nullable=False),
            sa.Column("redirect_uris_json", sa.String(), nullable=False),
            sa.Column("token_endpoint_auth_method", sa.String(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("client_id"),
        )
        op.create_index("ix_mcp_oauth_clients_client_id", "mcp_oauth_clients", ["client_id"])

    if "mcp_oauth_auth_requests" not in existing:
        op.create_table(
            "mcp_oauth_auth_requests",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("client_id", sa.String(), nullable=False),
            sa.Column("redirect_uri", sa.String(), nullable=False),
            sa.Column("state", sa.String(), nullable=False),
            sa.Column("scope", sa.String(), nullable=False),
            sa.Column("code_challenge", sa.String(), nullable=False),
            sa.Column("code_challenge_method", sa.String(), nullable=False),
            sa.Column("resource", sa.String(), nullable=False),
            sa.Column("expires_at", sa.DateTime(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            "ix_mcp_oauth_auth_requests_client_id", "mcp_oauth_auth_requests", ["client_id"]
        )
        op.create_index(
            "ix_mcp_oauth_auth_requests_expires_at", "mcp_oauth_auth_requests", ["expires_at"]
        )

    if "mcp_oauth_authorization_codes" not in existing:
        op.create_table(
            "mcp_oauth_authorization_codes",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("code_hash", sa.String(), nullable=False),
            sa.Column("client_id", sa.String(), nullable=False),
            sa.Column("user_id", sa.Uuid(), nullable=False),
            sa.Column("tenant_id", sa.Uuid(), nullable=False),
            sa.Column("scopes_json", sa.String(), nullable=False),
            sa.Column("redirect_uri", sa.String(), nullable=False),
            sa.Column("code_challenge", sa.String(), nullable=False),
            sa.Column("code_challenge_method", sa.String(), nullable=False),
            sa.Column("resource", sa.String(), nullable=False),
            sa.Column("expires_at", sa.DateTime(), nullable=False),
            sa.Column("used_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("code_hash"),
        )
        op.create_index(
            "ix_mcp_oauth_authorization_codes_code_hash",
            "mcp_oauth_authorization_codes",
            ["code_hash"],
        )
        op.create_index(
            "ix_mcp_oauth_authorization_codes_client_id",
            "mcp_oauth_authorization_codes",
            ["client_id"],
        )
        op.create_index(
            "ix_mcp_oauth_authorization_codes_user_id",
            "mcp_oauth_authorization_codes",
            ["user_id"],
        )
        op.create_index(
            "ix_mcp_oauth_authorization_codes_tenant_id",
            "mcp_oauth_authorization_codes",
            ["tenant_id"],
        )
        op.create_index(
            "ix_mcp_oauth_authorization_codes_expires_at",
            "mcp_oauth_authorization_codes",
            ["expires_at"],
        )

    if "mcp_oauth_access_tokens" not in existing:
        op.create_table(
            "mcp_oauth_access_tokens",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("token_hash", sa.String(), nullable=False),
            sa.Column("token_prefix", sa.String(), nullable=False),
            sa.Column("client_id", sa.String(), nullable=False),
            sa.Column("user_id", sa.Uuid(), nullable=False),
            sa.Column("tenant_id", sa.Uuid(), nullable=False),
            sa.Column("scopes_json", sa.String(), nullable=False),
            sa.Column("resource", sa.String(), nullable=False),
            sa.Column("expires_at", sa.DateTime(), nullable=False),
            sa.Column("revoked_at", sa.DateTime(), nullable=True),
            sa.Column("last_used_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("token_hash"),
        )
        op.create_index(
            "ix_mcp_oauth_access_tokens_token_hash", "mcp_oauth_access_tokens", ["token_hash"]
        )
        op.create_index(
            "ix_mcp_oauth_access_tokens_client_id", "mcp_oauth_access_tokens", ["client_id"]
        )
        op.create_index(
            "ix_mcp_oauth_access_tokens_user_id", "mcp_oauth_access_tokens", ["user_id"]
        )
        op.create_index(
            "ix_mcp_oauth_access_tokens_tenant_id", "mcp_oauth_access_tokens", ["tenant_id"]
        )
        op.create_index(
            "ix_mcp_oauth_access_tokens_expires_at", "mcp_oauth_access_tokens", ["expires_at"]
        )

    if "mcp_oauth_refresh_tokens" not in existing:
        op.create_table(
            "mcp_oauth_refresh_tokens",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("token_hash", sa.String(), nullable=False),
            sa.Column("access_token_id", sa.Uuid(), nullable=True),
            sa.Column("client_id", sa.String(), nullable=False),
            sa.Column("user_id", sa.Uuid(), nullable=False),
            sa.Column("tenant_id", sa.Uuid(), nullable=False),
            sa.Column("scopes_json", sa.String(), nullable=False),
            sa.Column("resource", sa.String(), nullable=False),
            sa.Column("expires_at", sa.DateTime(), nullable=False),
            sa.Column("revoked_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["access_token_id"], ["mcp_oauth_access_tokens.id"]),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("token_hash"),
        )
        op.create_index(
            "ix_mcp_oauth_refresh_tokens_token_hash", "mcp_oauth_refresh_tokens", ["token_hash"]
        )
        op.create_index(
            "ix_mcp_oauth_refresh_tokens_access_token_id",
            "mcp_oauth_refresh_tokens",
            ["access_token_id"],
        )
        op.create_index(
            "ix_mcp_oauth_refresh_tokens_client_id", "mcp_oauth_refresh_tokens", ["client_id"]
        )
        op.create_index(
            "ix_mcp_oauth_refresh_tokens_user_id", "mcp_oauth_refresh_tokens", ["user_id"]
        )
        op.create_index(
            "ix_mcp_oauth_refresh_tokens_tenant_id", "mcp_oauth_refresh_tokens", ["tenant_id"]
        )
        op.create_index(
            "ix_mcp_oauth_refresh_tokens_expires_at", "mcp_oauth_refresh_tokens", ["expires_at"]
        )


def downgrade() -> None:
    for table in (
        "mcp_oauth_refresh_tokens",
        "mcp_oauth_access_tokens",
        "mcp_oauth_authorization_codes",
        "mcp_oauth_auth_requests",
        "mcp_oauth_clients",
    ):
        if table in _tables(op.get_bind()):
            op.drop_table(table)
