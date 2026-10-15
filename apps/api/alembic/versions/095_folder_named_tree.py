"""Named folder tree: restore parent_id; membership stays via project_tag_links.

Revision ID: 095_folder_named_tree
Revises: 094_message_reactions
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "095_folder_named_tree"
down_revision = "094_message_reactions"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "projects" not in inspector.get_table_names():
        return

    cols = _columns("projects")
    if "parent_id" not in cols:
        op.add_column("projects", sa.Column("parent_id", sa.Uuid(), nullable=True))
    inspector = sa.inspect(bind)
    indexes = {i["name"] for i in inspector.get_indexes("projects")}
    if "ix_projects_parent_id" not in indexes:
        op.create_index("ix_projects_parent_id", "projects", ["parent_id"])
    fks = {fk["name"] for fk in inspector.get_foreign_keys("projects")}
    if "fk_projects_parent_id" not in fks:
        op.create_foreign_key(
            "fk_projects_parent_id",
            "projects",
            "projects",
            ["parent_id"],
            ["id"],
            ondelete="SET NULL",
        )

    # Backfill parent_id from former tag-set inclusion (largest proper subset).
    if not inspector.has_table("project_tag_links"):
        return
    rows = bind.execute(
        sa.text(
            "SELECT id, tenant_id, sort_order, name FROM projects WHERE deleted_at IS NULL"
        )
    ).mappings().all()
    links = bind.execute(
        sa.text("SELECT project_id, tag_id FROM project_tag_links")
    ).mappings().all()
    tags_by_project: dict = {}
    for link in links:
        tags_by_project.setdefault(link["project_id"], set()).add(link["tag_id"])

    by_tenant: dict = {}
    for row in rows:
        by_tenant.setdefault(row["tenant_id"], []).append(row)

    updates: list[tuple] = []
    for _tenant, folders in by_tenant.items():
        for folder in folders:
            mine = tags_by_project.get(folder["id"], set())
            if not mine:
                continue
            best_id = None
            best_size = -1
            best_order = 10**9
            best_name = ""
            for other in folders:
                if other["id"] == folder["id"]:
                    continue
                other_tags = tags_by_project.get(other["id"], set())
                if not other_tags or not other_tags < mine:
                    continue
                size = len(other_tags)
                order = int(other["sort_order"] or 0)
                name = (other["name"] or "").lower()
                if (
                    size > best_size
                    or (size == best_size and order < best_order)
                    or (size == best_size and order == best_order and name < best_name)
                ):
                    best_id = other["id"]
                    best_size = size
                    best_order = order
                    best_name = name
            if best_id is not None:
                updates.append((best_id, folder["id"]))

    for parent_id, project_id in updates:
        bind.execute(
            sa.text("UPDATE projects SET parent_id = :pid WHERE id = :id"),
            {"pid": parent_id, "id": project_id},
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "projects" not in inspector.get_table_names():
        return
    indexes = {i["name"] for i in inspector.get_indexes("projects")}
    if "ix_projects_parent_id" in indexes:
        op.drop_index("ix_projects_parent_id", table_name="projects")
    fks = {fk["name"] for fk in inspector.get_foreign_keys("projects")}
    if "fk_projects_parent_id" in fks:
        op.drop_constraint("fk_projects_parent_id", "projects", type_="foreignkey")
    if "parent_id" in _columns("projects"):
        op.drop_column("projects", "parent_id")
