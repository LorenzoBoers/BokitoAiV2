"""Outbound webhooks: webhook_endpoints + webhook_deliveries.

Revision ID: 005_webhooks
Revises: 004_user_totp

Guarded with an inspector check: fresh databases get these tables from the
003 baseline's create_all against live model metadata.
"""

import sqlalchemy as sa
from alembic import op

revision = "005_webhooks"
down_revision = "004_user_totp"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    if "webhook_endpoints" not in tables:
        op.create_table(
            "webhook_endpoints",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
            sa.Column("url", sa.String(), nullable=False, server_default=""),
            sa.Column("description", sa.String(), nullable=False, server_default=""),
            sa.Column("events_json", sa.String(), nullable=False, server_default='["*"]'),
            sa.Column("secret_encrypted", sa.String(), nullable=False, server_default=""),
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_by_user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("last_delivery_at", sa.DateTime(), nullable=True),
            sa.Column("last_status", sa.String(), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_webhook_endpoints_tenant_id", "webhook_endpoints", ["tenant_id"])
    if "webhook_deliveries" not in tables:
        op.create_table(
            "webhook_deliveries",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
            sa.Column(
                "endpoint_id", sa.Uuid(), sa.ForeignKey("webhook_endpoints.id"), nullable=False
            ),
            sa.Column("event", sa.String(), nullable=False, server_default=""),
            sa.Column("payload_json", sa.String(), nullable=False, server_default="{}"),
            sa.Column("status", sa.String(), nullable=False, server_default="pending"),
            sa.Column("status_code", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("error", sa.String(), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("delivered_at", sa.DateTime(), nullable=True),
        )
        op.create_index("ix_webhook_deliveries_tenant_id", "webhook_deliveries", ["tenant_id"])
        op.create_index("ix_webhook_deliveries_endpoint_id", "webhook_deliveries", ["endpoint_id"])
        op.create_index("ix_webhook_deliveries_event", "webhook_deliveries", ["event"])
        op.create_index("ix_webhook_deliveries_status", "webhook_deliveries", ["status"])


def downgrade() -> None:
    op.drop_table("webhook_deliveries")
    op.drop_table("webhook_endpoints")
