"""Add source column to custom_metrics (manual vs platform aggregate).

Revision ID: 010_metric_source
Revises: 009_inbox_settings_slim

"manual" metrics are filled by users/agents; platform-sourced metrics
(csat_30d, inbox_volume_7d, auto_resolve_rate_7d) are computed from
platform data and snapshotted daily by the worker.
"""

import sqlalchemy as sa
from alembic import op

revision = "010_metric_source"
down_revision = "009_inbox_settings_slim"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {c["name"] for c in sa.inspect(bind).get_columns("custom_metrics")}
    if "source" not in columns:
        op.add_column(
            "custom_metrics",
            sa.Column("source", sa.String(), nullable=False, server_default="manual"),
        )


def downgrade() -> None:
    with op.batch_alter_table("custom_metrics") as batch:
        batch.drop_column("source")
