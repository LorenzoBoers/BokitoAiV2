"""Add case_types.default_project_id.

A signal type may point at one project, so every case of that type lands
there when the conversation itself carries no project.

Revision ID: 041_case_type_default_project
Revises: 040_case_follow_up_task
"""

import sqlalchemy as sa
from alembic import op

revision = "041_case_type_default_project"
down_revision = "040_case_follow_up_task"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("case_types", sa.Column("default_project_id", sa.Uuid(), nullable=True))


def downgrade() -> None:
    op.drop_column("case_types", "default_project_id")
