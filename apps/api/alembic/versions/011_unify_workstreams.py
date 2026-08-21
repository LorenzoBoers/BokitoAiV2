"""Unify workstream models: project workstreams become orchestration workstreams.

Revision ID: 011_unify_workstreams
Revises: 010_metric_source

`project_workstreams` was a list-only model with no executor. Rows migrate
into the runnable `workstreams` table (scoped by a new nullable `project_id`)
so project workstreams can actually run; the old table is dropped.
"""

import sqlalchemy as sa
from alembic import op

revision = "011_unify_workstreams"
down_revision = "010_metric_source"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    columns = {c["name"] for c in inspector.get_columns("workstreams")}
    if "project_id" not in columns:
        op.add_column("workstreams", sa.Column("project_id", sa.Uuid(), nullable=True))
        op.create_index("ix_workstreams_project_id", "workstreams", ["project_id"])

    if "project_workstreams" in tables:
        rows = bind.execute(
            sa.text(
                "SELECT id, tenant_id, project_id, name, status, "
                "trigger_text, output_text FROM project_workstreams"
            )
        ).fetchall()
        for row in rows:
            description_bits = [
                part.strip()
                for part in ((row.trigger_text or ""), (row.output_text or ""))
                if part and part.strip()
            ]
            bind.execute(
                sa.text(
                    "INSERT INTO workstreams "
                    "(id, tenant_id, project_id, name, description, enabled, created_at) "
                    "VALUES (:id, :tenant_id, :project_id, :name, :description, :enabled, "
                    "CURRENT_TIMESTAMP)"
                ),
                {
                    "id": row.id,
                    "tenant_id": row.tenant_id,
                    "project_id": row.project_id,
                    "name": row.name,
                    "description": " -> ".join(description_bits)[:500],
                    "enabled": row.status == "active",
                },
            )
        op.drop_table("project_workstreams")


def downgrade() -> None:
    op.create_table(
        "project_workstreams",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), index=True),
        sa.Column("project_id", sa.Uuid(), sa.ForeignKey("projects.id"), index=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("slug", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="draft"),
        sa.Column("trigger_text", sa.String(), nullable=True),
        sa.Column("output_text", sa.String(), nullable=True),
        sa.Column("steps_json", sa.String(), nullable=False, server_default="[]"),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_active_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    with op.batch_alter_table("workstreams") as batch:
        batch.drop_index("ix_workstreams_project_id")
        batch.drop_column("project_id")
