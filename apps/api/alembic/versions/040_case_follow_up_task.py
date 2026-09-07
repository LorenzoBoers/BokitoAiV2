"""Add case_types.follow_up_task boolean.

Revision ID: 040_case_follow_up_task
Revises: 039_case_follow_up_mode
"""

import sqlalchemy as sa
from alembic import op

revision = "040_case_follow_up_task"
down_revision = "039_case_follow_up_mode"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "case_types",
        sa.Column(
            "follow_up_task",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("case_types", "follow_up_task")
