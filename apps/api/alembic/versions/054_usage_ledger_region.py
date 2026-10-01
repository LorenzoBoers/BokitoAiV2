"""Hosting region per usage row (EU-hosted by default).

Revision ID: 054_usage_ledger_region
Revises: 053_signal_hot_indexes
"""

import sqlalchemy as sa
from alembic import op

revision = "054_usage_ledger_region"
down_revision = "053_signal_hot_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    columns = {col["name"] for col in sa.inspect(conn).get_columns("usage_ledger")}
    if "region" not in columns:
        op.add_column(
            "usage_ledger",
            sa.Column("region", sa.String(), nullable=False, server_default="unknown"),
        )
    # Every call before this revision went to a US provider (Anthropic or
    # OpenAI), also behind the Bokito virtual slug. Mistral rows cannot exist yet.
    op.execute(
        "UPDATE usage_ledger SET region = 'us' "
        "WHERE region = 'unknown' AND provider IN ('bokito', 'anthropic', 'openai')"
    )
    op.execute("UPDATE usage_ledger SET region = 'eu' WHERE provider = 'mistral'")


def downgrade() -> None:
    op.drop_column("usage_ledger", "region")
