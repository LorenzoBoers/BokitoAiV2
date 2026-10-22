"""Work kind on signals and the recipe on flows.

- ``signals.work_kind`` replaces ``category`` and ``intent``. Existing reads map:
  question -> question; implementation_request, bug_report -> change;
  feedback, complaint -> notice. The rest stays empty until the next read.
- ``workstreams``: ``work_kinds_json``, ``instructions``, ``capabilities_json``,
  ``expected_outcome``.

Revision ID: 138_work_kind_flow_recipe
Revises: 137_signal_outcome
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "138_work_kind_flow_recipe"
down_revision = "137_signal_outcome"
branch_labels = None
depends_on = None

_INTENT_TO_KIND = {
    "question": "question",
    "implementation_request": "change",
    "bug_report": "change",
    "feedback": "notice",
    "complaint": "notice",
}


def _columns(bind, table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    if "signals" in tables:
        present = _columns(bind, "signals")
        if "work_kind" not in present:
            op.add_column("signals", sa.Column("work_kind", sa.String(length=20), nullable=True))
            op.create_index("ix_signals_work_kind", "signals", ["work_kind"])
        if "intent" in present:
            for intent, kind in _INTENT_TO_KIND.items():
                bind.execute(
                    sa.text("UPDATE signals SET work_kind = :kind WHERE intent = :intent AND work_kind IS NULL"),
                    {"kind": kind, "intent": intent},
                )
            op.drop_column("signals", "intent")
        if "category" in present:
            indexes = {ix["name"] for ix in sa.inspect(bind).get_indexes("signals")}
            if "ix_signals_category" in indexes:
                op.drop_index("ix_signals_category", table_name="signals")
            op.drop_column("signals", "category")
    if "workstreams" in tables:
        present = _columns(bind, "workstreams")
        for name, column in (
            ("work_kinds_json", sa.Column("work_kinds_json", sa.Text(), nullable=False, server_default="[]")),
            ("instructions", sa.Column("instructions", sa.Text(), nullable=False, server_default="")),
            ("capabilities_json", sa.Column("capabilities_json", sa.Text(), nullable=False, server_default="[]")),
            (
                "expected_outcome",
                sa.Column("expected_outcome", sa.String(length=20), nullable=False, server_default=""),
            ),
        ):
            if name not in present:
                op.add_column("workstreams", column)


def downgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    if "workstreams" in tables:
        present = _columns(bind, "workstreams")
        for name in ("expected_outcome", "capabilities_json", "instructions", "work_kinds_json"):
            if name in present:
                op.drop_column("workstreams", name)
    if "signals" in tables:
        present = _columns(bind, "signals")
        if "category" not in present:
            op.add_column("signals", sa.Column("category", sa.String(), nullable=True))
            op.create_index("ix_signals_category", "signals", ["category"])
        if "intent" not in present:
            op.add_column("signals", sa.Column("intent", sa.String(), nullable=True))
        if "work_kind" in present:
            op.drop_index("ix_signals_work_kind", table_name="signals")
            op.drop_column("signals", "work_kind")
