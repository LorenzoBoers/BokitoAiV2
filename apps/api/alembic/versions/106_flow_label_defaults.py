"""Backfill flow labels to sky + route when unmarked.

Revision ID: 106_flow_label_defaults
Revises: 105_tag_icon
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "106_flow_label_defaults"
down_revision = "105_tag_icon"
branch_labels = None
depends_on = None

FLOW_COLORS = ("rose", "teal", "violet", "orange", "emerald", "pink", "sky")


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "signal_tags" not in inspector.get_table_names():
        return
    cols = {c["name"] for c in inspector.get_columns("signal_tags")}
    if "workstream_id" not in cols or "color" not in cols:
        return
    # Action tags without a flow mark hue get sky. Empty icon gets route.
    placeholders = ", ".join(f"'{c}'" for c in FLOW_COLORS)
    op.execute(
        sa.text(
            f"""
            UPDATE signal_tags
            SET color = 'sky'
            WHERE workstream_id IS NOT NULL
              AND (color IS NULL OR trim(color) = '' OR lower(color) NOT IN ({placeholders}))
            """
        )
    )
    if "icon" in cols:
        op.execute(
            sa.text(
                """
                UPDATE signal_tags
                SET icon = 'route'
                WHERE workstream_id IS NOT NULL
                  AND (icon IS NULL OR trim(icon) = '')
                """
            )
        )


def downgrade() -> None:
    # Irreversible data backfill.
    pass
