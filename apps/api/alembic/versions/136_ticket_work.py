"""Ticket work: stage-entry policy per flow, deadlines and checklist state per ticket.

- ``workstreams.stage_entry_policy`` / ``stage_entry_threshold``: how an agent
  may place a ticket in a stage (empty / null follow the workspace default).
- ``signals.due_at`` / ``due_source`` / ``due_basis``: the ticket deadline and
  where it came from.
- ``signals.ticket_checklist_json``: ticked and proposed checklist items.

Revision ID: 136_ticket_work
Revises: 135_module_prompt_basics
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "136_ticket_work"
down_revision = "135_module_prompt_basics"
branch_labels = None
depends_on = None

_SIGNAL_COLUMNS = (
    ("due_source", sa.String(), ""),
    ("due_basis", sa.String(), ""),
    ("ticket_checklist_json", sa.Text(), "{}"),
)


def _columns(bind, table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    tables = sa.inspect(bind).get_table_names()
    if "workstreams" in tables:
        present = _columns(bind, "workstreams")
        if "stage_entry_policy" not in present:
            op.add_column(
                "workstreams",
                sa.Column("stage_entry_policy", sa.String(), nullable=False, server_default=""),
            )
        if "stage_entry_threshold" not in present:
            op.add_column("workstreams", sa.Column("stage_entry_threshold", sa.Integer(), nullable=True))
    if "signals" in tables:
        present = _columns(bind, "signals")
        if "due_at" not in present:
            op.add_column("signals", sa.Column("due_at", sa.DateTime(), nullable=True))
            op.create_index("ix_signals_due_at", "signals", ["due_at"])
        for name, type_, default in _SIGNAL_COLUMNS:
            if name not in present:
                op.add_column("signals", sa.Column(name, type_, nullable=False, server_default=default))


def downgrade() -> None:
    bind = op.get_bind()
    tables = sa.inspect(bind).get_table_names()
    if "signals" in tables:
        present = _columns(bind, "signals")
        for name, _type, _default in _SIGNAL_COLUMNS:
            if name in present:
                op.drop_column("signals", name)
        if "due_at" in present:
            op.drop_index("ix_signals_due_at", table_name="signals")
            op.drop_column("signals", "due_at")
    if "workstreams" in tables:
        present = _columns(bind, "workstreams")
        for name in ("stage_entry_threshold", "stage_entry_policy"):
            if name in present:
                op.drop_column("workstreams", name)
