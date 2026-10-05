"""Membership.is_active so people can be deactivated without deleting history.

Revision ID: 060_membership_is_active
Revises: 059_team_settings_json
"""

import sqlalchemy as sa
from alembic import op

revision = "060_membership_is_active"
down_revision = "059_team_settings_json"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "memberships" not in set(inspector.get_table_names()):
        return
    columns = {col["name"] for col in inspector.get_columns("memberships")}
    if "is_active" not in columns:
        op.add_column(
            "memberships",
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        )
    if "deactivated_at" not in columns:
        op.add_column(
            "memberships",
            sa.Column("deactivated_at", sa.DateTime(), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "memberships" not in set(inspector.get_table_names()):
        return
    columns = {col["name"] for col in inspector.get_columns("memberships")}
    if "deactivated_at" in columns:
        op.drop_column("memberships", "deactivated_at")
    if "is_active" in columns:
        op.drop_column("memberships", "is_active")
