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


def upgrade() -> None:
    op.add_column(
        "agents",
        sa.Column("default_channels_json", sa.Text(), nullable=False, server_default="[]"),
    )
    op.add_column(
        "agents",
        sa.Column("default_signal_types_json", sa.Text(), nullable=False, server_default="[]"),
    )
    op.add_column(
        "channel_accounts",
        sa.Column("default_agent_id", sa.Uuid(), nullable=True),
    )
    op.create_index(
        "ix_channel_accounts_default_agent_id",
        "channel_accounts",
        ["default_agent_id"],
    )
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
    op.drop_constraint(
        "fk_channel_accounts_default_agent_id_agents",
        "channel_accounts",
        type_="foreignkey",
    )
    op.drop_index(
        "ix_channel_accounts_default_agent_id",
        table_name="channel_accounts",
    )
    op.drop_column("channel_accounts", "default_agent_id")
    op.drop_column("agents", "default_signal_types_json")
    op.drop_column("agents", "default_channels_json")
