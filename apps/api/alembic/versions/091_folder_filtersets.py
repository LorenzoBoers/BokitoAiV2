"""Folders become saved tag filtersets (AND).

Creates ``project_tag_links`` from each project's path tags, adds
``projects.sort_order``, then drops parent/tag/group/po/budget/workbench
columns and the ``project_agents`` table.

Revision ID: 091_folder_filtersets
Revises: 090_tag_underscore
"""

from __future__ import annotations

from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision = "091_folder_filtersets"
down_revision = "090_tag_underscore"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name
    inspector = sa.inspect(bind)
    if not inspector.has_table("projects"):
        return

    if not inspector.has_table("project_tag_links"):
        op.create_table(
            "project_tag_links",
            sa.Column("project_id", sa.Uuid(), sa.ForeignKey("projects.id"), primary_key=True),
            sa.Column("tag_id", sa.Uuid(), sa.ForeignKey("signal_tags.id"), primary_key=True),
            sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_project_tag_links_tag_id", "project_tag_links", ["tag_id"])
        op.create_index("ix_project_tag_links_tenant_id", "project_tag_links", ["tenant_id"])

    inspector = sa.inspect(bind)
    cols = {c["name"] for c in inspector.get_columns("projects")}
    if "sort_order" not in cols:
        op.add_column(
            "projects",
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        )

    inspector = sa.inspect(bind)
    cols = {c["name"] for c in inspector.get_columns("projects")}
    now = datetime.utcnow()

    if "tag_id" in cols or "parent_id" in cols:
        projects = bind.execute(
            sa.text(
                "SELECT id, tenant_id, parent_id, tag_id FROM projects WHERE deleted_at IS NULL"
            )
        ).mappings().all()
        by_id = {row["id"]: dict(row) for row in projects}

        def path_tags(project_id):
            seen = set()
            ordered = []
            current = by_id.get(project_id)
            chain = []
            while current is not None:
                chain.append(current)
                parent = current.get("parent_id")
                current = by_id.get(parent) if parent else None
            for row in reversed(chain):
                tid = row.get("tag_id")
                if tid and tid not in seen:
                    seen.add(tid)
                    ordered.append(tid)
            return ordered

        insert_sql = sa.text(
            "INSERT INTO project_tag_links "
            "(project_id, tag_id, tenant_id, sort_order, created_at) "
            "VALUES (:pid, :tid, :tenant, :ord, :now) "
            "ON CONFLICT (project_id, tag_id) DO NOTHING"
        )
        for row in projects:
            tags = path_tags(row["id"])
            if not tags and row.get("tag_id"):
                tags = [row["tag_id"]]
            for index, tag_id in enumerate(tags):
                bind.execute(
                    insert_sql,
                    {
                        "pid": row["id"],
                        "tid": tag_id,
                        "tenant": row["tenant_id"],
                        "ord": index,
                        "now": now,
                    },
                )

    # Drop unique constraints / indexes if present (Postgres).
    if dialect == "postgresql":
        op.execute(sa.text("ALTER TABLE projects DROP CONSTRAINT IF EXISTS uq_projects_parent_tag"))
        op.execute(sa.text("ALTER TABLE projects DROP CONSTRAINT IF EXISTS uq_projects_root_tag"))
        for name in (
            "ix_projects_tag_id",
            "ix_projects_parent_id",
            "ix_projects_child_group_id",
            "ix_projects_po_agent_id",
            "ix_projects_workbench_connection_id",
        ):
            op.execute(sa.text(f"DROP INDEX IF EXISTS {name}"))
    else:
        for name in (
            "uq_projects_parent_tag",
            "uq_projects_root_tag",
            "ix_projects_tag_id",
            "ix_projects_parent_id",
            "ix_projects_child_group_id",
            "ix_projects_po_agent_id",
            "ix_projects_workbench_connection_id",
        ):
            try:
                op.drop_constraint(name, "projects", type_="unique")
            except Exception:
                pass
            try:
                op.drop_index(name, table_name="projects")
            except Exception:
                pass

    inspector = sa.inspect(bind)
    cols = {c["name"] for c in inspector.get_columns("projects")}
    for col in (
        "parent_id",
        "tag_id",
        "child_group_id",
        "po_agent_id",
        "token_budget_daily",
        "token_budget_hourly",
        "workbench_connection_id",
    ):
        if col in cols:
            op.drop_column("projects", col)

    inspector = sa.inspect(bind)
    if inspector.has_table("project_agents"):
        op.drop_table("project_agents")

    if inspector.has_table("project_resources"):
        bind.execute(sa.text("DELETE FROM project_resources WHERE resource_type = 'repo'"))


def downgrade() -> None:
    raise NotImplementedError("091_folder_filtersets is not reversible")
