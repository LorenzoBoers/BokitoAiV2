"""Add agents.settings_json (per-agent email signature and misc settings).

Revision ID: 013_agent_settings_json
Revises: 012_drop_dormant_project_tables

The reply-identity feature reads ``Agent.settings_json`` on every agent
select; without this column all agent endpoints 500 on Postgres. The column
was added to the SQLite dev schema patch but Postgres is Alembic-managed.
Guarded with an inspector check because production/staging were hotfixed
with a manual ALTER TABLE before this revision shipped.
"""

import sqlalchemy as sa
from alembic import op

revision = "013_agent_settings_json"
down_revision = "012_drop_dormant_project_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {c["name"] for c in inspector.get_columns("agents")}
    if "settings_json" not in columns:
        op.add_column(
            "agents",
            sa.Column("settings_json", sa.String(), nullable=False, server_default="{}"),
        )


def downgrade() -> None:
    op.drop_column("agents", "settings_json")
