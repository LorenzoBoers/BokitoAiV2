"""Per-project daily and hourly token caps.

Revision ID: 065_project_token_budget
Revises: 064_trash
"""

import sqlalchemy as sa
from alembic import op

revision = "065_project_token_budget"
down_revision = "064_trash"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "projects" not in inspector.get_table_names():
        return
    cols = {c["name"] for c in inspector.get_columns("projects")}
    if "token_budget_daily" not in cols:
        op.add_column("projects", sa.Column("token_budget_daily", sa.Integer(), nullable=True))
    if "token_budget_hourly" not in cols:
        op.add_column("projects", sa.Column("token_budget_hourly", sa.Integer(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "projects" not in inspector.get_table_names():
        return
    cols = {c["name"] for c in inspector.get_columns("projects")}
    if "token_budget_hourly" in cols:
        op.drop_column("projects", "token_budget_hourly")
    if "token_budget_daily" in cols:
        op.drop_column("projects", "token_budget_daily")
