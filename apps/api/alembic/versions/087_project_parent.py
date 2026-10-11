"""Projects can sit inside another project (folders).

Revision ID: 087_project_parent
Revises: 086_decision_bundle
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "087_project_parent"
down_revision = "086_decision_bundle"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    if "parent_id" not in _columns("projects"):
        op.add_column("projects", sa.Column("parent_id", sa.Uuid(), nullable=True))
    inspector = sa.inspect(op.get_bind())
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
    # Slug is unique among living projects that share a parent (roots share the empty parent).
    if "uq_projects_root_slug" not in indexes:
        op.create_index(
            "uq_projects_root_slug",
            "projects",
            ["tenant_id", "slug"],
            unique=True,
            postgresql_where=sa.text("parent_id IS NULL AND deleted_at IS NULL"),
            sqlite_where=sa.text("parent_id IS NULL AND deleted_at IS NULL"),
        )
    if "uq_projects_child_slug" not in indexes:
        op.create_index(
            "uq_projects_child_slug",
            "projects",
            ["tenant_id", "parent_id", "slug"],
            unique=True,
            postgresql_where=sa.text("parent_id IS NOT NULL AND deleted_at IS NULL"),
            sqlite_where=sa.text("parent_id IS NOT NULL AND deleted_at IS NULL"),
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "projects" not in inspector.get_table_names():
        return
    indexes = {i["name"] for i in inspector.get_indexes("projects")}
    for name in ("uq_projects_child_slug", "uq_projects_root_slug", "ix_projects_parent_id"):
        if name in indexes:
            op.drop_index(name, table_name="projects")
    fks = {fk["name"] for fk in inspector.get_foreign_keys("projects")}
    if "fk_projects_parent_id" in fks:
        op.drop_constraint("fk_projects_parent_id", "projects", type_="foreignkey")
    if "parent_id" in _columns("projects"):
        op.drop_column("projects", "parent_id")
