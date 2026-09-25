"""Add project workbench bindings and dispatched jobs.

Revision ID: 042_project_workbench
Revises: 041_case_type_default_project
"""

import sqlalchemy as sa
from alembic import op

revision = "042_project_workbench"
down_revision = "041_case_type_default_project"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "integration_connections",
        sa.Column("kind", sa.String(), nullable=False, server_default="integration"),
    )
    op.create_index(
        "ix_integration_connections_kind", "integration_connections", ["kind"]
    )
    op.add_column(
        "projects", sa.Column("workbench_connection_id", sa.Uuid(), nullable=True)
    )
    op.create_foreign_key(
        "fk_projects_workbench_connection",
        "projects",
        "integration_connections",
        ["workbench_connection_id"],
        ["id"],
    )
    op.create_index(
        "ix_projects_workbench_connection_id", "projects", ["workbench_connection_id"]
    )

    op.create_table(
        "work_jobs",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("signal_id", sa.Uuid(), nullable=True),
        sa.Column("case_id", sa.Uuid(), nullable=True),
        sa.Column("project_id", sa.Uuid(), nullable=True),
        sa.Column("workbench_connection_id", sa.Uuid(), nullable=True),
        sa.Column("agent_id", sa.Uuid(), nullable=True),
        sa.Column("provider", sa.String(), nullable=False, server_default="github_copilot"),
        sa.Column("state", sa.String(), nullable=False, server_default="queued"),
        sa.Column("external_ids_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("artifacts_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("summary", sa.Text(), nullable=False, server_default=""),
        sa.Column("brief_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("cost_cents", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["signal_id"], ["signals.id"]),
        sa.ForeignKeyConstraint(["case_id"], ["cases.id"]),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.ForeignKeyConstraint(
            ["workbench_connection_id"], ["integration_connections.id"]
        ),
        sa.ForeignKeyConstraint(["agent_id"], ["agents.id"]),
    )
    for column in (
        "tenant_id",
        "signal_id",
        "case_id",
        "project_id",
        "workbench_connection_id",
        "provider",
        "state",
    ):
        op.create_index(f"ix_work_jobs_{column}", "work_jobs", [column])


def downgrade() -> None:
    op.drop_table("work_jobs")
    op.drop_index("ix_projects_workbench_connection_id", table_name="projects")
    op.drop_constraint(
        "fk_projects_workbench_connection", "projects", type_="foreignkey"
    )
    op.drop_column("projects", "workbench_connection_id")
    op.drop_index(
        "ix_integration_connections_kind", table_name="integration_connections"
    )
    op.drop_column("integration_connections", "kind")
