"""Typed case fields schema for signal types.

Revision ID: 045_case_type_fields
Revises: 044_agent_shape
"""

import sqlalchemy as sa
from alembic import op

revision = "045_case_type_fields"
down_revision = "044_agent_shape"
branch_labels = None
depends_on = None


def _tables(conn) -> set[str]:
    return set(sa.inspect(conn).get_table_names())


def _columns(conn, table: str) -> set[str]:
    inspector = sa.inspect(conn)
    if table not in inspector.get_table_names():
        return set()
    return {column["name"] for column in inspector.get_columns(table)}


def _add(table: str, column: sa.Column) -> None:
    if column.name not in _columns(op.get_bind(), table):
        op.add_column(table, column)


def upgrade() -> None:
    _add(
        "case_types",
        sa.Column("fields_schema_json", sa.Text(), nullable=False, server_default="[]"),
    )
    _add(
        "case_types",
        sa.Column("show_as_folder", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    _add(
        "cases",
        sa.Column("fields_json", sa.Text(), nullable=False, server_default="{}"),
    )

    if "case_type_fields" not in _tables(op.get_bind()):
        op.create_table(
            "case_type_fields",
            sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
            sa.Column("tenant_id", sa.Uuid(), nullable=False),
            sa.Column("case_type_id", sa.Uuid(), nullable=False),
            sa.Column("slug", sa.String(), nullable=False),
            sa.Column("name", sa.String(), nullable=False),
            sa.Column("kind", sa.String(), nullable=False, server_default="text"),
            sa.Column("required", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("choices_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
            sa.ForeignKeyConstraint(["case_type_id"], ["case_types.id"]),
            sa.UniqueConstraint(
                "tenant_id",
                "case_type_id",
                "slug",
                name="uq_case_type_fields_slug",
            ),
        )
        op.create_index("ix_case_type_fields_tenant_id", "case_type_fields", ["tenant_id"])
        op.create_index(
            "ix_case_type_fields_case_type_id", "case_type_fields", ["case_type_id"]
        )


def downgrade() -> None:
    if "case_type_fields" in _tables(op.get_bind()):
        op.drop_index("ix_case_type_fields_case_type_id", table_name="case_type_fields")
        op.drop_index("ix_case_type_fields_tenant_id", table_name="case_type_fields")
        op.drop_table("case_type_fields")
    if "fields_json" in _columns(op.get_bind(), "cases"):
        op.drop_column("cases", "fields_json")
    existing = _columns(op.get_bind(), "case_types")
    if "show_as_folder" in existing:
        op.drop_column("case_types", "show_as_folder")
    if "fields_schema_json" in existing:
        op.drop_column("case_types", "fields_schema_json")
