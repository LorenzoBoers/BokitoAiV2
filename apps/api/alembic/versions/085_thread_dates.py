"""Thread dates: a thread with a date is an agenda item.

Adds ``signals.next_at`` / ``ends_at`` / ``schedule_json``, the recipient and
creator of a trigger, and the thread of a run and of a calendar event. Folds
snooze, follow-up and scheduled human tasks into ``next_at`` and drops the old
columns.

Revision ID: 085_thread_dates
Revises: 084_owner_routing
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "085_thread_dates"
down_revision = "084_owner_routing"
branch_labels = None
depends_on = None


_SIGNAL_COLUMNS = (
    ("next_at", sa.Column("next_at", sa.DateTime(), nullable=True)),
    ("ends_at", sa.Column("ends_at", sa.DateTime(), nullable=True)),
    ("schedule_json", sa.Column("schedule_json", sa.String(), server_default="{}", nullable=False)),
)
_TRIGGER_COLUMNS = (
    ("created_by_user_id", sa.Column("created_by_user_id", sa.Uuid(), nullable=True)),
    ("recipient_kind", sa.Column("recipient_kind", sa.String(), server_default="", nullable=False)),
    ("recipient_user_id", sa.Column("recipient_user_id", sa.Uuid(), nullable=True)),
    ("recipient_team_id", sa.Column("recipient_team_id", sa.Uuid(), nullable=True)),
)
_RUN_COLUMNS = (("signal_id", sa.Column("signal_id", sa.Uuid(), nullable=True)),)
_CALENDAR_COLUMNS = (("signal_id", sa.Column("signal_id", sa.Uuid(), nullable=True)),)
_RETIRED_SIGNAL_COLUMNS = ("snoozed_until", "follow_up_at", "follow_up_title")


def _columns(table: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(table)}


def _add_columns(table: str, columns) -> None:
    existing = _columns(table)
    if not existing:
        return
    with op.batch_alter_table(table) as batch:
        for name, column in columns:
            if name not in existing:
                batch.add_column(column)


def _index(table: str, column: str) -> None:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return
    name = f"ix_{table}_{column}"
    if name not in {i["name"] for i in inspector.get_indexes(table)}:
        op.create_index(name, table, [column])


def upgrade() -> None:
    _add_columns("signals", _SIGNAL_COLUMNS)
    _add_columns("triggers", _TRIGGER_COLUMNS)
    _add_columns("agent_runs", _RUN_COLUMNS)
    _add_columns("calendar_events", _CALENDAR_COLUMNS)
    _index("signals", "next_at")
    _index("triggers", "signal_id")
    _index("agent_runs", "signal_id")
    _index("calendar_events", "signal_id")

    bind = op.get_bind()
    signal_cols = _columns("signals")
    if "snoozed_until" in signal_cols:
        bind.execute(
            sa.text(
                "UPDATE signals SET next_at = snoozed_until "
                "WHERE next_at IS NULL AND snoozed_until IS NOT NULL"
            )
        )
    if "follow_up_at" in signal_cols:
        bind.execute(
            sa.text(
                "UPDATE signals SET next_at = follow_up_at "
                "WHERE next_at IS NULL AND follow_up_at IS NOT NULL"
            )
        )

    if _columns("agent_tasks"):
        # A planned human look-at is a date on its conversation.
        bind.execute(
            sa.text(
                """
                UPDATE signals SET next_at = (
                    SELECT MIN(t.scheduled_for) FROM agent_tasks t
                    WHERE t.signal_id = signals.id
                      AND t.assignee_kind = 'human'
                      AND t.status IN ('queued', 'awaiting_human')
                      AND t.scheduled_for IS NOT NULL
                      AND t.deleted_at IS NULL
                )
                WHERE next_at IS NULL AND EXISTS (
                    SELECT 1 FROM agent_tasks t
                    WHERE t.signal_id = signals.id
                      AND t.assignee_kind = 'human'
                      AND t.status IN ('queued', 'awaiting_human')
                      AND t.scheduled_for IS NOT NULL
                      AND t.deleted_at IS NULL
                )
                """
            )
        )
        bind.execute(
            sa.text(
                """
                UPDATE agent_tasks SET status = 'cancelled'
                WHERE assignee_kind = 'human'
                  AND status IN ('queued', 'awaiting_human')
                  AND scheduled_for IS NOT NULL
                  AND signal_id IS NOT NULL
                """
            )
        )

    if _columns("triggers"):
        # A repeat rule owns its thread's date.
        bind.execute(
            sa.text(
                """
                UPDATE signals SET next_at = (
                    SELECT MIN(tr.next_run_at) FROM triggers tr
                    WHERE tr.signal_id = signals.id AND tr.purpose = ''
                      AND tr.enabled = true AND tr.deleted_at IS NULL
                      AND tr.kind <> 'heartbeat'
                )
                WHERE EXISTS (
                    SELECT 1 FROM triggers tr
                    WHERE tr.signal_id = signals.id AND tr.purpose = ''
                      AND tr.enabled = true AND tr.deleted_at IS NULL
                      AND tr.next_run_at IS NOT NULL AND tr.kind <> 'heartbeat'
                )
                """
            )
        )

    retired = [c for c in _RETIRED_SIGNAL_COLUMNS if c in signal_cols]
    if retired:
        inspector = sa.inspect(bind)
        for idx in inspector.get_indexes("signals"):
            if set(idx.get("column_names") or []) & set(retired):
                op.drop_index(idx["name"], table_name="signals")
        with op.batch_alter_table("signals") as batch:
            for name in retired:
                batch.drop_column(name)


def downgrade() -> None:
    with op.batch_alter_table("signals") as batch:
        batch.add_column(sa.Column("snoozed_until", sa.DateTime(), nullable=True))
        batch.add_column(sa.Column("follow_up_at", sa.DateTime(), nullable=True))
        batch.add_column(sa.Column("follow_up_title", sa.String(), server_default="", nullable=False))
    for table, cols in (
        ("calendar_events", _CALENDAR_COLUMNS),
        ("agent_runs", _RUN_COLUMNS),
        ("triggers", _TRIGGER_COLUMNS),
        ("signals", _SIGNAL_COLUMNS),
    ):
        existing = _columns(table)
        with op.batch_alter_table(table) as batch:
            for name, _ in reversed(cols):
                if name in existing:
                    batch.drop_column(name)
