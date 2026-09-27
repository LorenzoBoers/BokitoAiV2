"""Platform-global remote MCP marketplace catalog tables.

Revision ID: 049_integration_catalog
Revises: 048_mcp_oauth_refresh_family
"""

import sqlalchemy as sa
from alembic import op

revision = "049_integration_catalog"
down_revision = "048_mcp_oauth_refresh_family"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    tables = set(sa.inspect(conn).get_table_names())
    if "integration_catalog_hosts" not in tables:
        op.create_table(
            "integration_catalog_hosts",
            sa.Column("slug", sa.String(length=64), primary_key=True),
            sa.Column("name", sa.String(), nullable=False, server_default=""),
            sa.Column("brand_color", sa.String(length=32), nullable=False, server_default="#475569"),
            sa.Column("initials", sa.String(length=8), nullable=False, server_default=""),
            sa.Column("logo_domain", sa.String(length=255), nullable=False, server_default=""),
            sa.Column("simpleicons", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("description", sa.String(), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )
    if "integration_catalog_providers" not in tables:
        op.create_table(
            "integration_catalog_providers",
            sa.Column("slug", sa.String(length=64), primary_key=True),
            sa.Column("static_id", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("host_slug", sa.String(length=64), nullable=False, server_default="custom"),
            sa.Column("name", sa.String(), nullable=False, server_default=""),
            sa.Column("description", sa.String(), nullable=False, server_default=""),
            sa.Column("category", sa.String(length=64), nullable=False, server_default="Productivity"),
            sa.Column("category_nl", sa.String(length=64), nullable=False, server_default="Productiviteit"),
            sa.Column("auth_type", sa.String(length=64), nullable=False, server_default="mcp_remote_oauth"),
            sa.Column("mcp_remote_url", sa.String(), nullable=False, server_default=""),
            sa.Column("mcp_transport", sa.String(length=64), nullable=False, server_default="streamable_http"),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="coming_soon"),
            sa.Column("module", sa.String(length=64), nullable=True),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="100"),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["host_slug"], ["integration_catalog_hosts.slug"]),
        )
        op.create_index(
            "ix_integration_catalog_providers_static_id",
            "integration_catalog_providers",
            ["static_id"],
        )
        op.create_index(
            "ix_integration_catalog_providers_host_slug",
            "integration_catalog_providers",
            ["host_slug"],
        )
        op.create_index(
            "ix_integration_catalog_providers_status",
            "integration_catalog_providers",
            ["status"],
        )
        op.create_index(
            "ix_integration_catalog_providers_enabled",
            "integration_catalog_providers",
            ["enabled"],
        )


def downgrade() -> None:
    conn = op.get_bind()
    tables = set(sa.inspect(conn).get_table_names())
    if "integration_catalog_providers" in tables:
        op.drop_table("integration_catalog_providers")
    if "integration_catalog_hosts" in tables:
        op.drop_table("integration_catalog_hosts")
