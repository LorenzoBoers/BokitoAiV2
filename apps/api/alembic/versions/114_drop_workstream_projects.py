"""Drop workstream_projects (direct flow↔folder links).

Revision ID: 114_drop_workstream_projects
Revises: 113_drop_workstream_enabled

Flow board lanes come from folders that share the flow's action tag via
``project_tag_links``. There is no separate attachment table.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "114_drop_workstream_projects"
down_revision = "113_drop_workstream_enabled"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "workstream_projects" in inspector.get_table_names():
        op.drop_table("workstream_projects")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "workstream_projects" in inspector.get_table_names():
        return
    op.create_table(
        "workstream_projects",
        sa.Column("workstream_id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["workstream_id"], ["workstreams.id"]),
        sa.PrimaryKeyConstraint("workstream_id", "project_id"),
    )
    op.create_index("ix_workstream_projects_tenant_id", "workstream_projects", ["tenant_id"])
    op.create_index("ix_workstream_projects_project_id", "workstream_projects", ["project_id"])
