"""Per-tag toggle: AI may auto-tag with this tag.

Revision ID: 081_tag_ai_auto_tag
Revises: 080_agent_description
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "081_tag_ai_auto_tag"
down_revision = "080_agent_description"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "signal_tags" not in inspector.get_table_names():
        return
    existing = {c["name"] for c in inspector.get_columns("signal_tags")}
    if "ai_auto_tag" in existing:
        return
    with op.batch_alter_table("signal_tags") as batch:
        batch.add_column(
            sa.Column("ai_auto_tag", sa.Boolean(), nullable=False, server_default=sa.true())
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "signal_tags" not in inspector.get_table_names():
        return
    existing = {c["name"] for c in inspector.get_columns("signal_tags")}
    if "ai_auto_tag" not in existing:
        return
    with op.batch_alter_table("signal_tags") as batch:
        batch.drop_column("ai_auto_tag")
