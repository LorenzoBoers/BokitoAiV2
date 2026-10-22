"""Per-tenant browser DOM debug log. Rows older than 48 hours are deleted on write.

Revision ID: 145_debug_dom
Revises: 144_thread_ux
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "145_debug_dom"
down_revision = "144_thread_ux"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if "debug_dom_events" in sa.inspect(bind).get_table_names():
        return
    op.create_table(
        "debug_dom_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("signal_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("feature", sa.String(length=40), nullable=False),
        sa.Column("name", sa.String(length=40), nullable=False),
        sa.Column("detail", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_debug_dom_tenant", "debug_dom_events", ["tenant_id", "created_at"])
    op.create_index("ix_debug_dom_created", "debug_dom_events", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_debug_dom_created", table_name="debug_dom_events")
    op.drop_index("ix_debug_dom_tenant", table_name="debug_dom_events")
    op.drop_table("debug_dom_events")
