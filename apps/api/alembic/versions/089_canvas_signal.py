"""Bind each snapshot canvas to a home conversation.

Revision ID: 089_canvas_signal
Revises: 088_tag_folders
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "089_canvas_signal"
down_revision = "088_tag_folders"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "project_canvases",
        sa.Column("signal_id", sa.Uuid(), nullable=True),
    )
    op.create_index("ix_project_canvases_signal_id", "project_canvases", ["signal_id"])
    op.create_foreign_key(
        "fk_project_canvases_signal_id",
        "project_canvases",
        "signals",
        ["signal_id"],
        ["id"],
    )
    op.execute(
        """
        UPDATE project_canvases AS c
        SET signal_id = t.signal_id
        FROM triggers AS t
        WHERE c.refresh_trigger_id = t.id
          AND c.signal_id IS NULL
          AND t.signal_id IS NOT NULL
        """
    )


def downgrade() -> None:
    op.drop_constraint("fk_project_canvases_signal_id", "project_canvases", type_="foreignkey")
    op.drop_index("ix_project_canvases_signal_id", table_name="project_canvases")
    op.drop_column("project_canvases", "signal_id")
