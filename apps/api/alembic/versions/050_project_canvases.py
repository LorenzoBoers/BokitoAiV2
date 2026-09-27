"""Project canvases — flexible AI-maintained project dashboards.

Revision ID: 050_project_canvases
Revises: 049_integration_catalog
"""

import sqlalchemy as sa
from alembic import op

revision = "050_project_canvases"
down_revision = "049_integration_catalog"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    tables = set(sa.inspect(conn).get_table_names())
    if "project_canvases" in tables:
        return
    op.create_table(
        "project_canvases",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("project_id", sa.Uuid(), sa.ForeignKey("projects.id"), nullable=False),
        sa.Column("slug", sa.String(length=64), nullable=False, server_default="main"),
        sa.Column("title", sa.String(), nullable=False, server_default="Canvas"),
        sa.Column("schema_version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("layout_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("widgets_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("updated_by_type", sa.String(length=32), nullable=False, server_default="system"),
        sa.Column("updated_by_id", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.UniqueConstraint("tenant_id", "project_id", "slug", name="uq_project_canvas_slug"),
    )
    op.create_index("ix_project_canvases_tenant_id", "project_canvases", ["tenant_id"])
    op.create_index("ix_project_canvases_project_id", "project_canvases", ["project_id"])
    op.create_index("ix_project_canvases_slug", "project_canvases", ["slug"])


def downgrade() -> None:
    conn = op.get_bind()
    tables = set(sa.inspect(conn).get_table_names())
    if "project_canvases" not in tables:
        return
    op.drop_index("ix_project_canvases_slug", table_name="project_canvases")
    op.drop_index("ix_project_canvases_project_id", table_name="project_canvases")
    op.drop_index("ix_project_canvases_tenant_id", table_name="project_canvases")
    op.drop_table("project_canvases")
