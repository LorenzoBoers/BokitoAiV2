"""Keep the previous body of every canvas kind.

Each write snapshots the live row before it is overwritten. Restoring
copies that snapshot forward as a newer revision.

Revision ID: 162_canvas_revisions
Revises: 161_invite_scope
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "162_canvas_revisions"
down_revision = "161_invite_scope"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "canvas_revisions",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False, index=True),
        sa.Column(
            "canvas_id",
            sa.Uuid(),
            sa.ForeignKey("project_canvases.id"),
            nullable=False,
            index=True,
        ),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(), nullable=False, server_default="Canvas"),
        sa.Column("kind", sa.String(length=16), nullable=False, server_default="dashboard"),
        sa.Column("language", sa.String(length=32), nullable=True),
        sa.Column("source", sa.Text(), nullable=False, server_default=""),
        sa.Column("tree_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("layout_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("updated_by_type", sa.String(length=32), nullable=False, server_default="system"),
        sa.Column("updated_by_id", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("canvas_id", "revision", name="uq_canvas_revision"),
    )


def downgrade() -> None:
    op.drop_table("canvas_revisions")
