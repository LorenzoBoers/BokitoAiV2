"""Icon mark on a label.

Revision ID: 105_tag_icon
Revises: 104_retire_job_tasks
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "105_tag_icon"
down_revision = "104_retire_job_tasks"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "signal_tags" not in inspector.get_table_names():
        return
    existing = {c["name"] for c in inspector.get_columns("signal_tags")}
    if "icon" in existing:
        return
    with op.batch_alter_table("signal_tags") as batch:
        batch.add_column(sa.Column("icon", sa.String(), nullable=False, server_default=""))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "signal_tags" not in inspector.get_table_names():
        return
    existing = {c["name"] for c in inspector.get_columns("signal_tags")}
    if "icon" not in existing:
        return
    with op.batch_alter_table("signal_tags") as batch:
        batch.drop_column("icon")
