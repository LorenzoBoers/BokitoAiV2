"""Case, CaseType, and CaseTypeBinding tables.

Revision ID: 038_cases
Revises: 037_thread_assurance
"""

import sqlalchemy as sa
from alembic import op

revision = "038_cases"
down_revision = "037_thread_assurance"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "case_types",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("slug", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("create_mode", sa.String(), nullable=False, server_default="ask_customer"),
        sa.Column("ask_threshold", sa.Integer(), nullable=False, server_default="6"),
        sa.Column("auto_threshold", sa.Integer(), nullable=False, server_default="9"),
        sa.Column("requires_verification", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "allow_project_link", sa.String(), nullable=False, server_default="optional"
        ),
        sa.Column("audience", sa.String(), nullable=False, server_default="both"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("module_slug", sa.String(), nullable=False, server_default=""),
        sa.Column("template_slug", sa.String(), nullable=False, server_default=""),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.UniqueConstraint("tenant_id", "slug", name="uq_case_types_tenant_slug"),
    )
    op.create_index("ix_case_types_tenant_id", "case_types", ["tenant_id"])
    op.create_index("ix_case_types_slug", "case_types", ["slug"])

    op.create_table(
        "cases",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("case_type_id", sa.Uuid(), nullable=False),
        sa.Column("signal_id", sa.Uuid(), nullable=False),
        sa.Column("contact_id", sa.Uuid(), nullable=True),
        sa.Column("project_id", sa.Uuid(), nullable=True),
        sa.Column("workstream_id", sa.Uuid(), nullable=True),
        sa.Column("workstream_run_id", sa.Uuid(), nullable=True),
        sa.Column("queue_item_id", sa.Uuid(), nullable=True),
        sa.Column("title", sa.String(), nullable=False, server_default=""),
        sa.Column("summary", sa.Text(), nullable=False, server_default=""),
        sa.Column("payload_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("status", sa.String(), nullable=False, server_default="open"),
        sa.Column("certainty", sa.Integer(), nullable=True),
        sa.Column("create_mode_used", sa.String(), nullable=False, server_default=""),
        sa.Column("created_by_type", sa.String(), nullable=False, server_default=""),
        sa.Column("created_by_id", sa.String(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["case_type_id"], ["case_types.id"]),
        sa.ForeignKeyConstraint(["signal_id"], ["signals.id"]),
        sa.ForeignKeyConstraint(["contact_id"], ["contacts.id"]),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"]),
        sa.ForeignKeyConstraint(["workstream_id"], ["workstreams.id"]),
        sa.ForeignKeyConstraint(["workstream_run_id"], ["workstream_runs.id"]),
    )
    op.create_index("ix_cases_tenant_id", "cases", ["tenant_id"])
    op.create_index("ix_cases_signal_id", "cases", ["signal_id"])
    op.create_index("ix_cases_case_type_id", "cases", ["case_type_id"])
    op.create_index("ix_cases_tenant_status", "cases", ["tenant_id", "status"])

    op.create_table(
        "case_type_bindings",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("case_type_id", sa.Uuid(), nullable=False),
        sa.Column("target_kind", sa.String(), nullable=False),
        sa.Column("target_id", sa.Uuid(), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("auto_link", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("auto_start_run", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["case_type_id"], ["case_types.id"]),
        sa.UniqueConstraint(
            "tenant_id",
            "case_type_id",
            "target_kind",
            "target_id",
            name="uq_case_type_bindings_target",
        ),
    )
    op.create_index(
        "ix_case_type_bindings_tenant_id", "case_type_bindings", ["tenant_id"]
    )
    op.create_index(
        "ix_case_type_bindings_case_type_id", "case_type_bindings", ["case_type_id"]
    )


def downgrade() -> None:
    op.drop_index("ix_case_type_bindings_case_type_id", table_name="case_type_bindings")
    op.drop_index("ix_case_type_bindings_tenant_id", table_name="case_type_bindings")
    op.drop_table("case_type_bindings")
    op.drop_index("ix_cases_tenant_status", table_name="cases")
    op.drop_index("ix_cases_case_type_id", table_name="cases")
    op.drop_index("ix_cases_signal_id", table_name="cases")
    op.drop_index("ix_cases_tenant_id", table_name="cases")
    op.drop_table("cases")
    op.drop_index("ix_case_types_slug", table_name="case_types")
    op.drop_index("ix_case_types_tenant_id", table_name="case_types")
    op.drop_table("case_types")
