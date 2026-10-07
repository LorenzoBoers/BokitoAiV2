"""Archive channels instead of deleting them.

Revision ID: 082_channel_archive
Revises: 081_tag_ai_auto_tag
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "082_channel_archive"
down_revision = "081_tag_ai_auto_tag"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "channel_accounts" not in inspector.get_table_names():
        return
    existing = {c["name"] for c in inspector.get_columns("channel_accounts")}
    if "archived_at" in existing:
        return
    with op.batch_alter_table("channel_accounts") as batch:
        batch.add_column(sa.Column("archived_at", sa.DateTime(), nullable=True))
        batch.create_index("ix_channel_accounts_archived_at", ["archived_at"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "channel_accounts" not in inspector.get_table_names():
        return
    existing = {c["name"] for c in inspector.get_columns("channel_accounts")}
    if "archived_at" not in existing:
        return
    with op.batch_alter_table("channel_accounts") as batch:
        batch.drop_index("ix_channel_accounts_archived_at")
        batch.drop_column("archived_at")
