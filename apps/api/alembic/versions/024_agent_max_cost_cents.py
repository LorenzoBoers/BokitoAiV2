"""Add agents.max_cost_cents (hard cost ceiling per task).

Revision ID: 024_agent_max_cost_cents
Revises: 023_adhesive_v1

Moved onto Agent when runtime_profiles were dropped; SQLite picked it up via
create_all/schema_patch, but Postgres needs an explicit Alembic revision or
startup fails the schema-drift assertion.
"""

import sqlalchemy as sa
from alembic import op

revision = "024_agent_max_cost_cents"
down_revision = "023_adhesive_v1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {c["name"] for c in inspector.get_columns("agents")}
    if "max_cost_cents" not in columns:
        op.add_column(
            "agents",
            sa.Column("max_cost_cents", sa.Integer(), nullable=False, server_default="0"),
        )


def downgrade() -> None:
    op.drop_column("agents", "max_cost_cents")
