"""Ticket intake field values on conversations.

Revision ID: 077_ticket_fields
Revises: 076_drop_workstream_steps
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "077_ticket_fields"
down_revision = "076_drop_workstream_steps"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "signals" not in inspector.get_table_names():
        return
    existing = {c["name"] for c in inspector.get_columns("signals")}
    if "ticket_fields_json" in existing:
        return
    with op.batch_alter_table("signals") as batch:
        batch.add_column(sa.Column("ticket_fields_json", sa.Text(), nullable=False, server_default="{}"))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "signals" not in inspector.get_table_names():
        return
    existing = {c["name"] for c in inspector.get_columns("signals")}
    if "ticket_fields_json" not in existing:
        return
    with op.batch_alter_table("signals") as batch:
        batch.drop_column("ticket_fields_json")
