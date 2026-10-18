"""Drop saved replies.

Revision ID: 111_drop_saved_replies
Revises: 110_setup_links

Canned replies are gone. Bin rows that pointed at them go with the table.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "111_drop_saved_replies"
down_revision = "110_setup_links"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "trash_entries" in tables:
        op.execute(sa.text("DELETE FROM trash_entries WHERE resource_type = 'saved_reply'"))
    if "saved_replies" in tables:
        op.drop_table("saved_replies")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "saved_replies" in inspector.get_table_names():
        return
    op.create_table(
        "saved_replies",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(), nullable=False, server_default=""),
        sa.Column("body_text", sa.String(), nullable=False, server_default=""),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.Column("deleted_by_user_id", sa.Uuid(), nullable=True),
        sa.Column("trash_batch_id", sa.Uuid(), nullable=True),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["deleted_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_saved_replies_tenant_id", "saved_replies", ["tenant_id"])
    op.create_index("ix_saved_replies_deleted_at", "saved_replies", ["deleted_at"])
    op.create_index("ix_saved_replies_trash_batch_id", "saved_replies", ["trash_batch_id"])
