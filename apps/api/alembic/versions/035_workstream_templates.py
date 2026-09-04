"""Workstream template provenance: module_slug + template_slug.

Workstreams installed from a module template keep a pointer to their origin
so the integrity checker can re-validate the template's requirements
(module installed, integration connected) before every run.

Revision ID: 035_workstream_templates
Revises: 034_project_default_workstreams
"""

import sqlalchemy as sa
from alembic import op

revision = "035_workstream_templates"
down_revision = "034_project_default_workstreams"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "workstreams",
        sa.Column("module_slug", sa.String(), nullable=False, server_default=""),
    )
    op.add_column(
        "workstreams",
        sa.Column("template_slug", sa.String(), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_column("workstreams", "template_slug")
    op.drop_column("workstreams", "module_slug")
