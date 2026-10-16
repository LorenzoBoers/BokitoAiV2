"""Retire promoted AgentTask kind=job shadow rows.

Revision ID: 104_retire_job_tasks
Revises: 103_signal_owner_slim
Create Date: 2026-10-15

Chat/trigger work promotion now lives on AgentRun only. Delete leftover
``kind=job`` tasks that were created by ``promote_run_to_task`` and clear
``agent_runs.task_id`` that pointed at them. Explicit orchestration jobs
created via the dispatcher keep their rows when context is not promoted.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "104_retire_job_tasks"
down_revision = "103_signal_owner_slim"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "agent_tasks" not in tables or "agent_runs" not in tables:
        return

    # Escape colons so SQLAlchemy does not treat ": true" as a bind param.
    promoted = (
        "kind = 'job' AND ("
        "context_json LIKE '%\"promoted\"\\: true%' "
        "OR context_json LIKE '%\"promoted\"\\:true%'"
        ")"
    )

    # Clear run links to promoted job tasks, then delete those tasks.
    op.execute(
        sa.text(
            f"""
            UPDATE agent_runs
            SET task_id = NULL
            WHERE task_id IN (
                SELECT id FROM agent_tasks
                WHERE {promoted}
            )
            """
        )
    )
    if "task_artifacts" in tables:
        op.execute(
            sa.text(
                f"""
                DELETE FROM task_artifacts
                WHERE agent_task_id IN (
                    SELECT id FROM agent_tasks
                    WHERE {promoted}
                )
                """
            )
        )
    op.execute(
        sa.text(
            f"""
            DELETE FROM agent_tasks
            WHERE {promoted}
            """
        )
    )


def downgrade() -> None:
    pass
