"""Workstream rebuild: linear steps, typed runs, worklog link.

Clean rebuild of the Workstream engine (initial build phase, no definition
migration): `workstreams` and `workstream_steps` are dropped and recreated
with the linear semantics (agent | wait | gate steps, goal prompts, deadline
handling, linked knowledge sections). New `workstream_runs` table carries one
execution with typed input, status, and summary; `agent_runs` gains a
`workstream_run_id` link so per-step worklogs attach to the run.

References into the old tables (`agent_tasks.workstream_id`,
`agent_tasks.current_step_id`, `agent_runs.step_id`,
`eval_checkpoints.step_id`, `triggers.workstream_id`) are nulled out and
their foreign keys recreated against the new tables.

Revision ID: 033_workstreams_rebuild
Revises: 032_doc_sections
"""

import sqlalchemy as sa
from alembic import op

revision = "033_workstreams_rebuild"
down_revision = "032_doc_sections"
branch_labels = None
depends_on = None

# (table, column, fk name pattern target)
_REFS = (
    ("agent_tasks", "workstream_id", "workstreams"),
    ("agent_tasks", "current_step_id", "workstream_steps"),
    ("agent_runs", "step_id", "workstream_steps"),
    ("eval_checkpoints", "step_id", "workstream_steps"),
    ("triggers", "workstream_id", "workstreams"),
)


def _drop_ref_fks(bind) -> None:
    """Drop whatever FK constraints point at the old workstream tables."""
    inspector = sa.inspect(bind)
    for table, column, target in _REFS:
        if not inspector.has_table(table):
            continue
        for fk in inspector.get_foreign_keys(table):
            if fk.get("referred_table") == target and column in (fk.get("constrained_columns") or []):
                name = fk.get("name")
                if name:
                    op.drop_constraint(name, table, type_="foreignkey")


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        _drop_ref_fks(bind)

    # Null out dangling references; the old definitions are dropped.
    for table, column, _ in _REFS:
        op.execute(sa.text(f"UPDATE {table} SET {column} = NULL WHERE {column} IS NOT NULL"))

    cascade = " CASCADE" if bind.dialect.name == "postgresql" else ""
    op.execute(sa.text(f"DROP TABLE IF EXISTS workstream_steps{cascade}"))
    op.execute(sa.text(f"DROP TABLE IF EXISTS workstream_runs{cascade}"))
    op.execute(sa.text(f"DROP TABLE IF EXISTS workstreams{cascade}"))

    op.create_table(
        "workstreams",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False, index=True),
        sa.Column("project_id", sa.Uuid(), sa.ForeignKey("projects.id"), nullable=True, index=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=False, server_default=""),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "workstream_steps",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "workstream_id", sa.Uuid(), sa.ForeignKey("workstreams.id"), nullable=False, index=True
        ),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False, index=True),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("kind", sa.String(), nullable=False, server_default="agent"),
        sa.Column("goal", sa.String(), nullable=False, server_default=""),
        sa.Column("agent_id", sa.Uuid(), sa.ForeignKey("agents.id"), nullable=True),
        sa.Column("agent_role", sa.String(), nullable=False, server_default=""),
        sa.Column("wait_kind", sa.String(), nullable=False, server_default="input"),
        sa.Column("deadline_hours", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("on_deadline", sa.String(), nullable=False, server_default="continue"),
        sa.Column(
            "knowledge_section_ids_json", sa.String(), nullable=False, server_default="[]"
        ),
        sa.Column("config_json", sa.String(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "workstream_runs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False, index=True),
        sa.Column(
            "workstream_id", sa.Uuid(), sa.ForeignKey("workstreams.id"), nullable=False, index=True
        ),
        sa.Column("project_id", sa.Uuid(), sa.ForeignKey("projects.id"), nullable=True, index=True),
        sa.Column("status", sa.String(), nullable=False, server_default="running", index=True),
        sa.Column("input_kind", sa.String(), nullable=False, server_default="manual"),
        sa.Column("input_ref", sa.String(), nullable=False, server_default=""),
        sa.Column("input_text", sa.String(), nullable=False, server_default=""),
        sa.Column(
            "current_step_id", sa.Uuid(), sa.ForeignKey("workstream_steps.id"), nullable=True
        ),
        sa.Column("wait_until", sa.DateTime(), nullable=True, index=True),
        sa.Column("reminded_at", sa.DateTime(), nullable=True),
        sa.Column("summary", sa.String(), nullable=False, server_default=""),
        sa.Column("error", sa.String(), nullable=False, server_default=""),
        sa.Column("context_json", sa.String(), nullable=False, server_default="{}"),
        sa.Column("triggered_by_type", sa.String(), nullable=False, server_default="user"),
        sa.Column("triggered_by_id", sa.String(), nullable=False, server_default=""),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
    )

    # Worklog link: one AgentRun per executed agent step.
    inspector = sa.inspect(bind)
    agent_run_columns = {c["name"] for c in inspector.get_columns("agent_runs")}
    if "workstream_run_id" not in agent_run_columns:
        op.add_column("agent_runs", sa.Column("workstream_run_id", sa.Uuid(), nullable=True))
        op.create_index(
            "ix_agent_runs_workstream_run_id", "agent_runs", ["workstream_run_id"]
        )

    if bind.dialect.name == "postgresql":
        op.create_foreign_key(
            "fk_agent_runs_workstream_run_id",
            "agent_runs",
            "workstream_runs",
            ["workstream_run_id"],
            ["id"],
        )
        op.create_foreign_key(
            "fk_agent_tasks_workstream_id", "agent_tasks", "workstreams", ["workstream_id"], ["id"]
        )
        op.create_foreign_key(
            "fk_agent_tasks_current_step_id",
            "agent_tasks",
            "workstream_steps",
            ["current_step_id"],
            ["id"],
        )
        op.create_foreign_key(
            "fk_agent_runs_step_id", "agent_runs", "workstream_steps", ["step_id"], ["id"]
        )
        op.create_foreign_key(
            "fk_eval_checkpoints_step_id",
            "eval_checkpoints",
            "workstream_steps",
            ["step_id"],
            ["id"],
        )
        op.create_foreign_key(
            "fk_triggers_workstream_id", "triggers", "workstreams", ["workstream_id"], ["id"]
        )


def downgrade() -> None:
    raise NotImplementedError("Workstream rebuild is not reversible.")
