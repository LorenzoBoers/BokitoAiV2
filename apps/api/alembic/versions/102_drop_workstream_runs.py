"""Retire workstream_runs; attribute via workstream_id on runs and usage.

Revision ID: 102_drop_workstream_runs
Revises: 101_drop_dead_schema
Create Date: 2026-10-15

Stages-only playbooks no longer create run receipts. Ticket state lives on
signals; AgentRun / UsageLedger keep an optional workstream_id for attribution.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "102_drop_workstream_runs"
down_revision = "101_drop_dead_schema"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if table not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(table)}


def _drop_fk_on_column(table: str, column: str) -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if table not in inspector.get_table_names():
        return
    for fk in inspector.get_foreign_keys(table):
        if column in (fk.get("constrained_columns") or []):
            name = fk.get("name")
            if name:
                op.drop_constraint(name, table, type_="foreignkey")


def _drop_indexes_on_column(table: str, column: str) -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if table not in inspector.get_table_names():
        return
    for index in inspector.get_indexes(table):
        if column in (index.get("column_names") or []):
            name = index.get("name")
            if name:
                op.drop_index(name, table_name=table)


def _add_workstream_id(table: str) -> None:
    cols = _columns(table)
    if not cols or "workstream_id" in cols:
        return
    op.add_column(table, sa.Column("workstream_id", sa.Uuid(), nullable=True))
    op.create_index(f"ix_{table}_workstream_id", table, ["workstream_id"])
    try:
        op.create_foreign_key(
            f"fk_{table}_workstream_id_workstreams",
            table,
            "workstreams",
            ["workstream_id"],
            ["id"],
        )
    except Exception:  # noqa: BLE001 — sqlite may already be loose
        pass


def _backfill(table: str) -> None:
    cols = _columns(table)
    if "workstream_run_id" not in cols or "workstream_id" not in cols:
        return
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "workstream_runs" not in tables:
        return
    op.execute(
        sa.text(
            f"""
            UPDATE {table}
            SET workstream_id = (
                SELECT workstream_runs.workstream_id
                FROM workstream_runs
                WHERE workstream_runs.id = {table}.workstream_run_id
            )
            WHERE workstream_run_id IS NOT NULL
              AND workstream_id IS NULL
            """
        )
    )


def _drop_workstream_run_id(table: str) -> None:
    cols = _columns(table)
    if "workstream_run_id" not in cols:
        return
    _drop_fk_on_column(table, "workstream_run_id")
    _drop_indexes_on_column(table, "workstream_run_id")
    op.drop_column(table, "workstream_run_id")


def upgrade() -> None:
    for table in ("agent_runs", "usage_ledger"):
        _add_workstream_id(table)
        _backfill(table)
        _drop_workstream_run_id(table)

    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "workstream_runs" in tables:
        op.drop_table("workstream_runs")


def downgrade() -> None:
    pass
