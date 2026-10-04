"""Add teams.settings_json for avatar and future team prefs.

Revision ID: 059_team_settings_json
Revises: 058_workbench_gateway
"""

import sqlalchemy as sa
from alembic import op

revision = "059_team_settings_json"
down_revision = "058_workbench_gateway"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "teams" not in set(inspector.get_table_names()):
        return
    columns = {col["name"] for col in inspector.get_columns("teams")}
    if "settings_json" not in columns:
        op.add_column(
            "teams",
            sa.Column("settings_json", sa.String(), nullable=False, server_default="{}"),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "teams" not in set(inspector.get_table_names()):
        return
    columns = {col["name"] for col in inspector.get_columns("teams")}
    if "settings_json" in columns:
        op.drop_column("teams", "settings_json")
