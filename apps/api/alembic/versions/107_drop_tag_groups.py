"""Drop tag groups and clear color on free labels.

Revision ID: 107_drop_tag_groups
Revises: 106_flow_label_defaults
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "107_drop_tag_groups"
down_revision = "106_flow_label_defaults"
branch_labels = None
depends_on = None


def _columns(inspector: sa.Inspector, table: str) -> set[str]:
    if table not in inspector.get_table_names():
        return set()
    return {column["name"] for column in inspector.get_columns(table)}


def _indexes(inspector: sa.Inspector, table: str) -> set[str]:
    if table not in inspector.get_table_names():
        return set()
    return {index["name"] for index in inspector.get_indexes(table) if index.get("name")}


def _fk_names(inspector: sa.Inspector, table: str) -> set[str]:
    if table not in inspector.get_table_names():
        return set()
    return {fk["name"] for fk in inspector.get_foreign_keys(table) if fk.get("name")}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "signal_tags" in inspector.get_table_names():
        op.execute(
            sa.text(
                """
                UPDATE signal_tags
                SET color = '', icon = ''
                WHERE workstream_id IS NULL
                """
            )
        )
    for table, column, index_name, fk_name in (
        ("signal_tags", "group_id", "ix_signal_tags_group_id", "fk_signal_tags_group_id"),
        ("projects", "child_group_id", "ix_projects_child_group_id", "fk_projects_child_group_id"),
    ):
        if column not in _columns(inspector, table):
            continue
        if index_name in _indexes(inspector, table):
            op.drop_index(index_name, table_name=table)
        with op.batch_alter_table(table) as batch:
            if fk_name in _fk_names(inspector, table):
                batch.drop_constraint(fk_name, type_="foreignkey")
            batch.drop_column(column)
        inspector = sa.inspect(bind)
    if inspector.has_table("tag_groups"):
        op.drop_table("tag_groups")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("tag_groups"):
        op.create_table(
            "tag_groups",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("tenant_id", sa.Uuid(), nullable=False),
            sa.Column("name", sa.String(), nullable=False),
            sa.Column("slug", sa.String(), nullable=False),
            sa.Column("description", sa.String(), nullable=False),
            sa.Column("exclusive", sa.Boolean(), nullable=False),
            sa.Column("sort_order", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("tenant_id", "slug", name="uq_tag_groups_tenant_slug"),
        )
        op.create_index("ix_tag_groups_tenant_id", "tag_groups", ["tenant_id"])
        op.create_index("ix_tag_groups_slug", "tag_groups", ["slug"])
    if "group_id" not in _columns(inspector, "signal_tags") and "signal_tags" in inspector.get_table_names():
        with op.batch_alter_table("signal_tags") as batch:
            batch.add_column(sa.Column("group_id", sa.Uuid(), nullable=True))
            batch.create_foreign_key(
                "fk_signal_tags_group_id", "tag_groups", ["group_id"], ["id"], ondelete="SET NULL"
            )
        op.create_index("ix_signal_tags_group_id", "signal_tags", ["group_id"])
    if "child_group_id" not in _columns(inspector, "projects") and "projects" in inspector.get_table_names():
        with op.batch_alter_table("projects") as batch:
            batch.add_column(sa.Column("child_group_id", sa.Uuid(), nullable=True))
            batch.create_foreign_key(
                "fk_projects_child_group_id", "tag_groups", ["child_group_id"], ["id"], ondelete="SET NULL"
            )
        op.create_index("ix_projects_child_group_id", "projects", ["child_group_id"])
