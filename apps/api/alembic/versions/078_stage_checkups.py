"""Stage check-ups run as triggers tied to a ticket's stage.

Revision ID: 078_stage_checkups
Revises: 077_ticket_fields
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "078_stage_checkups"
down_revision = "077_ticket_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "triggers" not in inspector.get_table_names():
        return
    existing = {c["name"] for c in inspector.get_columns("triggers")}
    with op.batch_alter_table("triggers") as batch:
        if "purpose" not in existing:
            batch.add_column(sa.Column("purpose", sa.String(), nullable=False, server_default=""))
            batch.create_index("ix_triggers_purpose", ["purpose"])
        if "stage_key" not in existing:
            batch.add_column(sa.Column("stage_key", sa.String(), nullable=False, server_default=""))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "triggers" not in inspector.get_table_names():
        return
    existing = {c["name"] for c in inspector.get_columns("triggers")}
    with op.batch_alter_table("triggers") as batch:
        if "purpose" in existing:
            batch.drop_index("ix_triggers_purpose")
            batch.drop_column("purpose")
        if "stage_key" in existing:
            batch.drop_column("stage_key")
