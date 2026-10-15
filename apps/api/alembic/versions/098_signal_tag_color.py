"""Optional color preset on labels (signal_tags).

Revision ID: 098_signal_tag_color
Revises: 097_signal_active_turn
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "098_signal_tag_color"
down_revision = "097_signal_active_turn"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = {c["name"] for c in inspector.get_columns("signal_tags")} if inspector.has_table("signal_tags") else set()
    if "color" not in cols:
        op.add_column(
            "signal_tags",
            sa.Column("color", sa.String(length=32), nullable=False, server_default=""),
        )


def downgrade() -> None:
    op.drop_column("signal_tags", "color")
