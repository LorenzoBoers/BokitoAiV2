"""Temporary thread UX event log.

Operators report a rough chat moment; these rows are what was on screen.
No product screen reads them.

Revision ID: 144_thread_ux
Revises: 143_canvas_kind
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "144_thread_ux"
down_revision = "143_canvas_kind"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if "thread_ux_events" in sa.inspect(bind).get_table_names():
        return
    op.create_table(
        "thread_ux_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("signal_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("name", sa.String(length=40), nullable=False),
        sa.Column("detail", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_thread_ux_signal", "thread_ux_events", ["signal_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_thread_ux_signal", table_name="thread_ux_events")
    op.drop_table("thread_ux_events")
