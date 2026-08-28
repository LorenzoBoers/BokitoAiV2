"""Alembic: module_sources for platform + tenant module knowledge.

Revision ID: 019_module_sources
Revises: 018_signal_tags
"""

import sqlalchemy as sa
from alembic import op

revision = "019_module_sources"
down_revision = "018_signal_tags"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("module_sources"):
        return
    op.create_table(
        "module_sources",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("module_slug", sa.String(), nullable=False, server_default=""),
        sa.Column("kind", sa.String(), nullable=False, server_default="web"),
        sa.Column("origin", sa.String(), nullable=False, server_default="tenant"),
        sa.Column("title", sa.String(), nullable=False, server_default=""),
        sa.Column("url", sa.String(), nullable=False, server_default=""),
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("auto_reindex", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("workspace_doc_id", sa.Uuid(), sa.ForeignKey("workspace_docs.id"), nullable=True),
        sa.Column("last_synced_at", sa.DateTime(), nullable=True),
        sa.Column("sync_error", sa.String(), nullable=False, server_default=""),
        sa.Column("metadata_json", sa.String(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_module_sources_tenant_id", "module_sources", ["tenant_id"])
    op.create_index("ix_module_sources_module_slug", "module_sources", ["module_slug"])
    op.create_index("ix_module_sources_status", "module_sources", ["status"])
    op.create_index("ix_module_sources_origin", "module_sources", ["origin"])
    op.create_index("ix_module_sources_workspace_doc_id", "module_sources", ["workspace_doc_id"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("module_sources"):
        return
    op.drop_index("ix_module_sources_workspace_doc_id", table_name="module_sources")
    op.drop_index("ix_module_sources_origin", table_name="module_sources")
    op.drop_index("ix_module_sources_status", table_name="module_sources")
    op.drop_index("ix_module_sources_module_slug", table_name="module_sources")
    op.drop_index("ix_module_sources_tenant_id", table_name="module_sources")
    op.drop_table("module_sources")
