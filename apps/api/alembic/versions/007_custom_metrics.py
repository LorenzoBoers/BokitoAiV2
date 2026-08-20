"""Custom cockpit metrics: definitions + observation points.

Revision ID: 007_custom_metrics
Revises: 006_companies

Guarded with inspector checks: fresh databases get these from the 003
baseline's create_all against live model metadata.
"""

import sqlalchemy as sa
from alembic import op

revision = "007_custom_metrics"
down_revision = "006_companies"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "custom_metrics" not in tables:
        op.create_table(
            "custom_metrics",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
            sa.Column("key", sa.String(), nullable=False, server_default=""),
            sa.Column("label", sa.String(), nullable=False, server_default=""),
            sa.Column("description", sa.String(), nullable=False, server_default=""),
            sa.Column("unit", sa.String(), nullable=False, server_default="number"),
            sa.Column("target", sa.Float(), nullable=True),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_custom_metrics_tenant_id", "custom_metrics", ["tenant_id"])
        op.create_index("ix_custom_metrics_key", "custom_metrics", ["key"])
    if "custom_metric_points" not in tables:
        op.create_table(
            "custom_metric_points",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
            sa.Column(
                "metric_id", sa.Uuid(), sa.ForeignKey("custom_metrics.id"), nullable=False
            ),
            sa.Column("value", sa.Float(), nullable=False, server_default="0"),
            sa.Column("note", sa.String(), nullable=False, server_default=""),
            sa.Column("source", sa.String(), nullable=False, server_default="user"),
            sa.Column("recorded_by", sa.String(), nullable=False, server_default=""),
            sa.Column("recorded_at", sa.DateTime(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
        op.create_index(
            "ix_custom_metric_points_tenant_id", "custom_metric_points", ["tenant_id"]
        )
        op.create_index(
            "ix_custom_metric_points_metric_id", "custom_metric_points", ["metric_id"]
        )
        op.create_index(
            "ix_custom_metric_points_recorded_at", "custom_metric_points", ["recorded_at"]
        )


def downgrade() -> None:
    op.drop_table("custom_metric_points")
    op.drop_table("custom_metrics")
