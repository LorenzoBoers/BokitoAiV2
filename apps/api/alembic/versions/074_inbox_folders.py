"""Saved-filter folders for Communication; drop CaseType.show_as_folder.

Revision ID: 074_inbox_folders
Revises: 073_signal_tag_links
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "074_inbox_folders"
down_revision = "073_signal_tag_links"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("inbox_folders"):
        op.create_table(
            "inbox_folders",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
            sa.Column("name", sa.String(), nullable=False, server_default=""),
            sa.Column("filter_json", sa.String(), nullable=False, server_default="{}"),
            sa.Column("scope", sa.String(), nullable=False, server_default="workspace"),
            sa.Column("owner_user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_inbox_folders_tenant_id", "inbox_folders", ["tenant_id"])
        op.create_index("ix_inbox_folders_owner_user_id", "inbox_folders", ["owner_user_id"])
    if "show_as_folder" in {c["name"] for c in inspector.get_columns("case_types")}:
        with op.batch_alter_table("case_types") as batch:
            batch.drop_column("show_as_folder")


def downgrade() -> None:
    with op.batch_alter_table("case_types") as batch:
        batch.add_column(
            sa.Column("show_as_folder", sa.Boolean(), nullable=False, server_default=sa.false())
        )
    op.drop_index("ix_inbox_folders_owner_user_id", table_name="inbox_folders")
    op.drop_index("ix_inbox_folders_tenant_id", table_name="inbox_folders")
    op.drop_table("inbox_folders")
