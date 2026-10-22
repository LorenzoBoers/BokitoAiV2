"""The flow label is the work kind.

- drop ``signals.work_kind``: the label on the conversation says what the work is;
- drop ``workstreams.work_kinds_json``: what a flow handles follows from its label;
- ``workstreams.expected_outcome`` becomes free text.

Revision ID: 139_label_is_work_kind
Revises: 138_work_kind_flow_recipe
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "139_label_is_work_kind"
down_revision = "138_work_kind_flow_recipe"
branch_labels = None
depends_on = None


def _columns(bind, table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    if "signals" in tables and "work_kind" in _columns(bind, "signals"):
        indexes = {ix["name"] for ix in sa.inspect(bind).get_indexes("signals")}
        if "ix_signals_work_kind" in indexes:
            op.drop_index("ix_signals_work_kind", table_name="signals")
        op.drop_column("signals", "work_kind")
    if "workstreams" in tables:
        present = _columns(bind, "workstreams")
        if "work_kinds_json" in present:
            op.drop_column("workstreams", "work_kinds_json")
        if "expected_outcome" in present and bind.dialect.name != "sqlite":
            op.alter_column(
                "workstreams",
                "expected_outcome",
                existing_type=sa.String(length=20),
                type_=sa.Text(),
                existing_nullable=False,
                existing_server_default="",
            )


def downgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    if "workstreams" in tables:
        present = _columns(bind, "workstreams")
        if "work_kinds_json" not in present:
            op.add_column(
                "workstreams", sa.Column("work_kinds_json", sa.Text(), nullable=False, server_default="[]")
            )
    if "signals" in tables and "work_kind" not in _columns(bind, "signals"):
        op.add_column("signals", sa.Column("work_kind", sa.String(length=20), nullable=True))
        op.create_index("ix_signals_work_kind", "signals", ["work_kind"])
