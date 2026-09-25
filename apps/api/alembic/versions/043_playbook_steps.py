"""Canonical playbook step kinds and signal-backed runs.

Revision ID: 043_playbook_steps
Revises: 042_retire_legacy_routing
"""

import sqlalchemy as sa
from alembic import op

revision = "043_playbook_steps"
down_revision = "042_retire_legacy_routing"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    columns = {
        column["name"]
        for column in sa.inspect(conn).get_columns("workstream_runs")
    }
    if "signal_id" not in columns:
        with op.batch_alter_table("workstream_runs") as batch:
            batch.add_column(sa.Column("signal_id", sa.Uuid(), nullable=True))
            batch.create_foreign_key(
                "fk_workstream_runs_signal_id_signals", "signals", ["signal_id"], ["id"]
            )
            batch.create_index("ix_workstream_runs_signal_id", ["signal_id"])

    # Existing case-backed runs already identify their tracked signal.
    conn.execute(
        sa.text(
            "UPDATE workstream_runs SET signal_id = ("
            "SELECT cases.signal_id FROM cases "
            "WHERE cases.workstream_run_id = workstream_runs.id LIMIT 1"
            ") WHERE signal_id IS NULL"
        )
    )
    conn.execute(
        sa.text(
            "UPDATE workstream_steps SET kind = CASE "
            "WHEN kind = 'agent' THEN 'agent_task' "
            "WHEN kind = 'gate' THEN 'ask_decision' "
            "WHEN kind = 'wait' AND wait_kind = 'time' THEN 'schedule' "
            "WHEN kind = 'wait' THEN 'wait_for_reply' "
            "ELSE kind END"
        )
    )
    conn.execute(
        sa.text(
            "UPDATE workstream_runs SET signal_id = NULL WHERE id IN ("
            "SELECT id FROM ("
            "SELECT id, ROW_NUMBER() OVER ("
            "PARTITION BY tenant_id, workstream_id, signal_id "
            "ORDER BY started_at, id"
            ") AS duplicate_number FROM workstream_runs WHERE signal_id IS NOT NULL"
            ") duplicates WHERE duplicate_number > 1)"
        )
    )
    op.create_index(
        "uq_workstream_runs_signal_playbook",
        "workstream_runs",
        ["tenant_id", "workstream_id", "signal_id"],
        unique=True,
    )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        sa.text(
            "UPDATE workstream_steps SET kind = CASE "
            "WHEN kind IN ('send_message', 'agent_task', 'call_tool') THEN 'agent' "
            "WHEN kind IN ('wait_for_reply', 'schedule') THEN 'wait' "
            "WHEN kind = 'ask_decision' THEN 'gate' "
            "ELSE kind END"
        )
    )
    op.drop_index("uq_workstream_runs_signal_playbook", table_name="workstream_runs")
    with op.batch_alter_table("workstream_runs") as batch:
        batch.drop_index("ix_workstream_runs_signal_id")
        batch.drop_constraint("fk_workstream_runs_signal_id_signals", type_="foreignkey")
        batch.drop_column("signal_id")
