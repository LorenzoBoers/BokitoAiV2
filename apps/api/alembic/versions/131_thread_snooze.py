"""Snooze on the thread; the conversation owner is who a planned moment is for.

Adds ``signals.hidden_until`` (status ``snoozed`` keeps a thread out of the
open lists until then). Drops ``triggers.recipient_*``: a rule's recipient now
is the conversation owner. A recipient that differed from an empty owner is
copied onto the thread first.

Revision ID: 131_thread_snooze
Revises: 130_agent_asks
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "131_thread_snooze"
down_revision = "130_agent_asks"
branch_labels = None
depends_on = None

_RECIPIENT_COLUMNS = ("recipient_kind", "recipient_user_id", "recipient_department_id")


def _columns(bind, table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(bind).get_columns(table)}


def _copy_recipients(bind) -> None:
    rows = bind.execute(
        sa.text(
            """
            SELECT t.signal_id, t.recipient_kind, t.recipient_user_id, t.recipient_department_id
            FROM triggers t
            JOIN signals s ON s.id = t.signal_id
            WHERE t.deleted_at IS NULL
              AND t.purpose = ''
              AND t.recipient_kind IN ('user', 'department')
              AND (s.assignee_kind IS NULL OR s.assignee_kind = '')
            """
        )
    ).fetchall()
    for signal_id, kind, user_id, department_id in rows:
        owner_id = user_id if kind == "user" else department_id
        if owner_id is None:
            continue
        bind.execute(
            sa.text("UPDATE signals SET assignee_kind = :kind, assignee_id = :owner WHERE id = :id"),
            {"kind": kind, "owner": owner_id, "id": signal_id},
        )


def upgrade() -> None:
    bind = op.get_bind()
    tables = sa.inspect(bind).get_table_names()
    if "signals" in tables:
        if "hidden_until" not in _columns(bind, "signals"):
            op.add_column("signals", sa.Column("hidden_until", sa.DateTime(), nullable=True))
        indexes = {i["name"] for i in sa.inspect(bind).get_indexes("signals")}
        if "ix_signals_hidden_until" not in indexes:
            op.create_index("ix_signals_hidden_until", "signals", ["hidden_until"])
    if "triggers" in tables:
        present = _columns(bind, "triggers")
        if "recipient_kind" in present:
            _copy_recipients(bind)
        for column in _RECIPIENT_COLUMNS:
            if column in present:
                op.drop_column("triggers", column)


def downgrade() -> None:
    bind = op.get_bind()
    tables = sa.inspect(bind).get_table_names()
    if "triggers" in tables:
        present = _columns(bind, "triggers")
        if "recipient_kind" not in present:
            op.add_column("triggers", sa.Column("recipient_kind", sa.String(), server_default="", nullable=False))
        if "recipient_user_id" not in present:
            op.add_column("triggers", sa.Column("recipient_user_id", sa.Uuid(), nullable=True))
        if "recipient_department_id" not in present:
            op.add_column("triggers", sa.Column("recipient_department_id", sa.Uuid(), nullable=True))
    if "signals" in tables and "hidden_until" in _columns(bind, "signals"):
        op.drop_index("ix_signals_hidden_until", table_name="signals")
        op.drop_column("signals", "hidden_until")
