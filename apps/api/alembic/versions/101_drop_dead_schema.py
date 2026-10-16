"""Drop retired tables and always-null step columns.

Revision ID: 101_drop_dead_schema
Revises: 100_handoff_session_json
Create Date: 2026-10-15

Removes:
- channel_bindings (routing retired; API 410)
- eval_checkpoints (writes stopped; RunEvent owns eval)
- os_canvas_nodes / os_canvas_edges (overlay retired; project_canvases stays)
- custom_tables family (router unmounted)
- operational_outcomes (trading-era side table)
- always-null step_id / current_step_id left after workstream_steps drop
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "101_drop_dead_schema"
down_revision = "100_handoff_session_json"
branch_labels = None
depends_on = None

_CUSTOM_TABLES = (
    "custom_record_comments",
    "custom_record_activities",
    "custom_views",
    "custom_records",
    "custom_fields",
    "custom_tables",
)

_DROP_TABLES = (
    "channel_bindings",
    "eval_checkpoints",
    "os_canvas_edges",
    "os_canvas_nodes",
    "operational_outcomes",
    *_CUSTOM_TABLES,
)

_DROP_COLUMNS = (
    ("workstream_runs", "current_step_id"),
    ("agent_runs", "step_id"),
    ("agent_tasks", "current_step_id"),
    ("agent_tasks", "step_id"),
)


def _table_names() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def _columns(table: str) -> set[str]:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if table not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(table)}


def _drop_column_if_exists(table: str, column: str) -> None:
    cols = _columns(table)
    if column not in cols:
        return
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    for fk in inspector.get_foreign_keys(table):
        if column in (fk.get("constrained_columns") or []):
            name = fk.get("name")
            if name:
                op.drop_constraint(name, table, type_="foreignkey")
    for index in inspector.get_indexes(table):
        if column in (index.get("column_names") or []):
            name = index.get("name")
            if name:
                op.drop_index(name, table_name=table)
    op.drop_column(table, column)


def upgrade() -> None:
    tables = _table_names()
    # Edges before nodes (FK).
    for table in _DROP_TABLES:
        if table in tables:
            op.drop_table(table)
            tables.discard(table)

    for table, column in _DROP_COLUMNS:
        _drop_column_if_exists(table, column)


def downgrade() -> None:
    # Retired surfaces; no recreate.
    pass
