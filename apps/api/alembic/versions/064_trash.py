"""Workspace Bin: tombstones + trash_entries index.

Revision ID: 064_trash
Revises: 063_canvas_nodes
"""

import sqlalchemy as sa
from alembic import op

revision = "064_trash"
down_revision = "063_canvas_nodes"
branch_labels = None
depends_on = None

TOMBSTONE_TABLES = (
    "signals",
    "contacts",
    "companies",
    "projects",
    "project_canvases",
    "workspace_docs",
    "workstreams",
    "triggers",
    "teams",
    "inbox_rules",
    "saved_replies",
    "case_types",
    "project_resources",
    "agent_tasks",
)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    for table in TOMBSTONE_TABLES:
        if table not in tables:
            continue
        cols = {c["name"] for c in inspector.get_columns(table)}
        if "deleted_at" not in cols:
            op.add_column(table, sa.Column("deleted_at", sa.DateTime(), nullable=True))
        if "deleted_by_user_id" not in cols:
            op.add_column(table, sa.Column("deleted_by_user_id", sa.Uuid(), nullable=True))
        if "trash_batch_id" not in cols:
            op.add_column(table, sa.Column("trash_batch_id", sa.Uuid(), nullable=True))
    if "triggers" in tables:
        cols = {c["name"] for c in inspector.get_columns("triggers")}
        if "trash_was_enabled" not in cols:
            op.add_column("triggers", sa.Column("trash_was_enabled", sa.Boolean(), nullable=True))
    if "workstreams" in tables:
        cols = {c["name"] for c in inspector.get_columns("workstreams")}
        if "trash_was_enabled" not in cols:
            op.add_column("workstreams", sa.Column("trash_was_enabled", sa.Boolean(), nullable=True))
    if "workstream_runs" in tables:
        # Playbook purge detaches history instead of deleting runs.
        pass

    if "trash_entries" not in tables:
        op.create_table(
            "trash_entries",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False, index=True),
            sa.Column("resource_type", sa.String(), nullable=False, index=True),
            sa.Column("resource_id", sa.Uuid(), nullable=False, index=True),
            sa.Column("title", sa.String(), nullable=False, server_default=""),
            sa.Column("preview", sa.String(), nullable=False, server_default=""),
            sa.Column("deleted_at", sa.DateTime(), nullable=False),
            sa.Column("purge_after", sa.DateTime(), nullable=False, index=True),
            sa.Column("deleted_by_user_id", sa.Uuid(), nullable=True),
            sa.Column("batch_id", sa.Uuid(), nullable=False, index=True),
            sa.Column("parent_entry_id", sa.Uuid(), sa.ForeignKey("trash_entries.id"), nullable=True),
            sa.Column("restore_hint_json", sa.String(), nullable=False, server_default="{}"),
        )

    if "project_canvases" in tables:
        try:
            op.drop_constraint("uq_canvas_owner_slug", "project_canvases", type_="unique")
        except Exception:
            pass
        op.execute(
            sa.text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_canvas_owner_slug_alive "
                "ON project_canvases (tenant_id, owner_kind, owner_id, slug) "
                "WHERE deleted_at IS NULL"
            )
        )
    if "case_types" in tables:
        try:
            op.drop_constraint("uq_case_types_tenant_slug", "case_types", type_="unique")
        except Exception:
            pass
        op.execute(
            sa.text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_case_types_tenant_slug_alive "
                "ON case_types (tenant_id, slug) WHERE deleted_at IS NULL"
            )
        )


def downgrade() -> None:
    op.drop_table("trash_entries")
