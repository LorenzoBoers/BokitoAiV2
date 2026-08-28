"""Conversation-driven project work: queue, doc sections, links, resources.

Adds project_queue_items, project_doc_sections, queue_item_doc_links and
project_resources; scopes workspace_docs by project_id; migrates the inline
GitHub repo columns on projects into a project_resources row and drops them.

Revision ID: 016_project_work
Revises: 015_project_agents
"""

import uuid
from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision = "016_project_work"
down_revision = "015_project_agents"
branch_labels = None
depends_on = None

PROJECT_REPO_COLUMNS = (
    "github_connection_id",
    "repo_binding_id",
    "github_repo_full_name",
    "github_default_branch",
    "repo_source",
    "repo_connected_at",
    "repo_index_status",
    "repo_indexed_at",
    "repo_index_error",
    "repo_last_commit_sha",
)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("project_queue_items"):
        op.create_table(
            "project_queue_items",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
            sa.Column("project_id", sa.Uuid(), sa.ForeignKey("projects.id"), nullable=False),
            sa.Column("kind", sa.String(), nullable=False, server_default="task"),
            sa.Column("title", sa.String(), nullable=False),
            sa.Column("body", sa.String(), nullable=False, server_default=""),
            sa.Column("priority", sa.String(), nullable=False, server_default="normal"),
            sa.Column("status", sa.String(), nullable=False, server_default="proposed"),
            sa.Column(
                "duplicate_of_id",
                sa.Uuid(),
                sa.ForeignKey("project_queue_items.id"),
                nullable=True,
            ),
            sa.Column("origin_type", sa.String(), nullable=False, server_default="user"),
            sa.Column("signal_id", sa.Uuid(), sa.ForeignKey("signals.id"), nullable=True),
            sa.Column(
                "message_id", sa.Uuid(), sa.ForeignKey("signal_messages.id"), nullable=True
            ),
            sa.Column("created_by_type", sa.String(), nullable=False, server_default="user"),
            sa.Column("created_by_id", sa.String(), nullable=False, server_default=""),
            sa.Column("impact_summary", sa.String(), nullable=False, server_default=""),
            sa.Column("analyzed_at", sa.DateTime(), nullable=True),
            sa.Column(
                "assigned_agent_id", sa.Uuid(), sa.ForeignKey("agents.id"), nullable=True
            ),
            sa.Column("metadata_json", sa.String(), nullable=False, server_default="{}"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_project_queue_items_tenant_id", "project_queue_items", ["tenant_id"])
        op.create_index(
            "ix_project_queue_items_project_id", "project_queue_items", ["project_id"]
        )
        op.create_index("ix_project_queue_items_kind", "project_queue_items", ["kind"])
        op.create_index("ix_project_queue_items_priority", "project_queue_items", ["priority"])
        op.create_index("ix_project_queue_items_status", "project_queue_items", ["status"])
        op.create_index("ix_project_queue_items_signal_id", "project_queue_items", ["signal_id"])

    if not inspector.has_table("project_doc_sections"):
        op.create_table(
            "project_doc_sections",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
            sa.Column("project_id", sa.Uuid(), sa.ForeignKey("projects.id"), nullable=False),
            sa.Column("doc_id", sa.Uuid(), sa.ForeignKey("workspace_docs.id"), nullable=False),
            sa.Column("anchor", sa.String(), nullable=False),
            sa.Column("heading", sa.String(), nullable=False, server_default=""),
            sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("status", sa.String(), nullable=False, server_default="open"),
            sa.Column("status_changed_at", sa.DateTime(), nullable=True),
            sa.Column(
                "status_changed_by_type", sa.String(), nullable=False, server_default=""
            ),
            sa.Column("status_changed_by_id", sa.String(), nullable=False, server_default=""),
            sa.Column("summary", sa.String(), nullable=False, server_default=""),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("doc_id", "anchor", name="uq_doc_section_anchor"),
        )
        op.create_index("ix_project_doc_sections_tenant_id", "project_doc_sections", ["tenant_id"])
        op.create_index(
            "ix_project_doc_sections_project_id", "project_doc_sections", ["project_id"]
        )
        op.create_index("ix_project_doc_sections_doc_id", "project_doc_sections", ["doc_id"])
        op.create_index("ix_project_doc_sections_status", "project_doc_sections", ["status"])

    if not inspector.has_table("queue_item_doc_links"):
        op.create_table(
            "queue_item_doc_links",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
            sa.Column(
                "queue_item_id",
                sa.Uuid(),
                sa.ForeignKey("project_queue_items.id"),
                nullable=False,
            ),
            sa.Column(
                "section_id",
                sa.Uuid(),
                sa.ForeignKey("project_doc_sections.id"),
                nullable=False,
            ),
            sa.Column("relation", sa.String(), nullable=False, server_default="touches"),
            sa.Column("created_by_type", sa.String(), nullable=False, server_default="agent"),
            sa.Column("created_by_id", sa.String(), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("queue_item_id", "section_id", name="uq_queue_item_section"),
        )
        op.create_index("ix_queue_item_doc_links_tenant_id", "queue_item_doc_links", ["tenant_id"])
        op.create_index(
            "ix_queue_item_doc_links_queue_item_id", "queue_item_doc_links", ["queue_item_id"]
        )
        op.create_index(
            "ix_queue_item_doc_links_section_id", "queue_item_doc_links", ["section_id"]
        )

    if not inspector.has_table("project_resources"):
        op.create_table(
            "project_resources",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
            sa.Column("project_id", sa.Uuid(), sa.ForeignKey("projects.id"), nullable=False),
            sa.Column("resource_type", sa.String(), nullable=False),
            sa.Column("provider", sa.String(), nullable=False, server_default=""),
            sa.Column(
                "connection_id",
                sa.Uuid(),
                sa.ForeignKey("integration_connections.id"),
                nullable=True,
            ),
            sa.Column("label", sa.String(), nullable=False, server_default=""),
            sa.Column("external_ref", sa.String(), nullable=False, server_default=""),
            sa.Column("config_json", sa.String(), nullable=False, server_default="{}"),
            sa.Column("status", sa.String(), nullable=False, server_default="linked"),
            sa.Column("sync_status", sa.String(), nullable=True),
            sa.Column("synced_at", sa.DateTime(), nullable=True),
            sa.Column("sync_error", sa.String(), nullable=True),
            sa.Column("sync_ref", sa.String(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_project_resources_tenant_id", "project_resources", ["tenant_id"])
        op.create_index("ix_project_resources_project_id", "project_resources", ["project_id"])
        op.create_index(
            "ix_project_resources_resource_type", "project_resources", ["resource_type"]
        )

    workspace_cols = {c["name"] for c in inspector.get_columns("workspace_docs")}
    if "project_id" not in workspace_cols:
        op.add_column(
            "workspace_docs",
            sa.Column("project_id", sa.Uuid(), sa.ForeignKey("projects.id"), nullable=True),
        )
        op.create_index("ix_workspace_docs_project_id", "workspace_docs", ["project_id"])

    # Migrate inline GitHub repo columns into project_resources, then drop them.
    project_cols = {c["name"] for c in inspector.get_columns("projects")}
    if "github_repo_full_name" in project_cols:
        rows = bind.execute(
            sa.text(
                "SELECT id, tenant_id, github_repo_full_name, github_default_branch, "
                "github_connection_id, repo_connected_at, repo_index_status, "
                "repo_indexed_at, repo_index_error, repo_last_commit_sha "
                "FROM projects WHERE github_repo_full_name IS NOT NULL"
            )
        ).fetchall()
        for row in rows:
            bind.execute(
                sa.text(
                    "INSERT INTO project_resources "
                    "(id, tenant_id, project_id, resource_type, provider, connection_id, "
                    "label, external_ref, config_json, status, sync_status, synced_at, "
                    "sync_error, sync_ref, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :project_id, 'repo', 'github', :connection_id, "
                    ":label, :external_ref, :config_json, :status, :sync_status, :synced_at, "
                    ":sync_error, :sync_ref, :created_at, :created_at)"
                ),
                {
                    "id": uuid.uuid4(),
                    "tenant_id": row.tenant_id,
                    "project_id": row.id,
                    "connection_id": row.github_connection_id,
                    "label": row.github_repo_full_name,
                    "external_ref": row.github_repo_full_name,
                    "config_json": (
                        '{"default_branch": "%s"}' % (row.github_default_branch or "main")
                    ),
                    "status": "connected" if row.github_connection_id else "linked",
                    "sync_status": row.repo_index_status or "none",
                    "synced_at": row.repo_indexed_at,
                    "sync_error": row.repo_index_error,
                    "sync_ref": row.repo_last_commit_sha,
                    "created_at": row.repo_connected_at or datetime.utcnow(),
                },
            )
        for column in PROJECT_REPO_COLUMNS:
            if column in project_cols:
                op.drop_column("projects", column)


def downgrade() -> None:
    op.drop_table("queue_item_doc_links")
    op.drop_table("project_doc_sections")
    op.drop_table("project_queue_items")
    op.drop_table("project_resources")
    op.drop_index("ix_workspace_docs_project_id", table_name="workspace_docs")
    op.drop_column("workspace_docs", "project_id")
