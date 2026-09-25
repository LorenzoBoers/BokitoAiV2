"""Unify agent shape and channel defaults.

Revision ID: 044_agent_shape
Revises: current agent-shape prerequisite heads
"""

import sqlalchemy as sa
from alembic import op

revision = "044_agent_shape"
down_revision = (
    "042_case_lifecycle_statuses",
    "042_project_workbench",
    "043_learning_autonomy_mvp",
    "043_playbook_steps",
)
branch_labels = None
depends_on = None


def _columns(conn, table: str) -> set[str]:
    inspector = sa.inspect(conn)
    if table not in inspector.get_table_names():
        return set()
    return {column["name"] for column in inspector.get_columns(table)}


def _add(table: str, column: sa.Column) -> None:
    if column.name not in _columns(op.get_bind(), table):
        op.add_column(table, column)


def _indexes(conn, table: str) -> set[str]:
    inspector = sa.inspect(conn)
    if table not in inspector.get_table_names():
        return set()
    return {index["name"] for index in inspector.get_indexes(table) if index.get("name")}


def _fks(conn, table: str) -> set[str]:
    inspector = sa.inspect(conn)
    if table not in inspector.get_table_names():
        return set()
    return {fk["name"] for fk in inspector.get_foreign_keys(table) if fk.get("name")}


def upgrade() -> None:
    # Shape columns may already exist on SQLite via create_all/schema_patch,
    # but Postgres only gets them through this revision.
    _add(
        "agents",
        sa.Column("audience", sa.String(), nullable=False, server_default="internal"),
    )
    _add(
        "agents",
        sa.Column("acts_for_user", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    if "ix_agents_acts_for_user" not in _indexes(op.get_bind(), "agents"):
        op.create_index("ix_agents_acts_for_user", "agents", ["acts_for_user"])
    _add(
        "agents",
        sa.Column("default_channels_json", sa.Text(), nullable=False, server_default="[]"),
    )
    _add(
        "agents",
        sa.Column("default_signal_types_json", sa.Text(), nullable=False, server_default="[]"),
    )
    _add(
        "channel_accounts",
        sa.Column("default_agent_id", sa.Uuid(), nullable=True),
    )
    if "ix_channel_accounts_default_agent_id" not in _indexes(op.get_bind(), "channel_accounts"):
        op.create_index(
            "ix_channel_accounts_default_agent_id",
            "channel_accounts",
            ["default_agent_id"],
        )
    if "fk_channel_accounts_default_agent_id_agents" not in _fks(
        op.get_bind(), "channel_accounts"
    ):
        op.create_foreign_key(
            "fk_channel_accounts_default_agent_id_agents",
            "channel_accounts",
            "agents",
            ["default_agent_id"],
            ["id"],
        )
    op.execute(
        """
        UPDATE channel_accounts
        SET default_agent_id = (
            SELECT cb.agent_id
            FROM channel_bindings cb
            WHERE cb.channel_account_id = channel_accounts.id
              AND cb.enabled = true
            ORDER BY cb.priority DESC
            LIMIT 1
        )
        WHERE default_agent_id IS NULL
        """
    )
    op.execute(
        """
        UPDATE agents
        SET acts_for_user = true,
            audience = 'internal',
            kind = 'company',
            role = 'assistant'
        WHERE role = 'personal_assistant'
           OR kind = 'personal_assistant'
        """
    )


def downgrade() -> None:
    if "fk_channel_accounts_default_agent_id_agents" in _fks(op.get_bind(), "channel_accounts"):
        op.drop_constraint(
            "fk_channel_accounts_default_agent_id_agents",
            "channel_accounts",
            type_="foreignkey",
        )
    if "ix_channel_accounts_default_agent_id" in _indexes(op.get_bind(), "channel_accounts"):
        op.drop_index(
            "ix_channel_accounts_default_agent_id",
            table_name="channel_accounts",
        )
    existing_channels = _columns(op.get_bind(), "channel_accounts")
    if "default_agent_id" in existing_channels:
        op.drop_column("channel_accounts", "default_agent_id")
    existing_agents = _columns(op.get_bind(), "agents")
    for column in (
        "default_signal_types_json",
        "default_channels_json",
        "acts_for_user",
        "audience",
    ):
        if column in existing_agents:
            if column == "acts_for_user" and "ix_agents_acts_for_user" in _indexes(
                op.get_bind(), "agents"
            ):
                op.drop_index("ix_agents_acts_for_user", table_name="agents")
            op.drop_column("agents", column)
