"""Add missing columns on existing SQLite/Postgres tables (create_all does not ALTER)."""

from __future__ import annotations

from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection
from sqlalchemy.types import TypeEngine
from sqlmodel import SQLModel

# Manual overrides when auto-inference is insufficient (table -> column -> SQL fragment)
COLUMN_PATCHES: dict[str, dict[str, str]] = {
    "users": {
        "job_title": "VARCHAR DEFAULT ''",
        "avatar_url": "VARCHAR",
        "is_staff": "BOOLEAN DEFAULT 0",
    },
    "agents": {
        "slug": "VARCHAR DEFAULT ''",
        "runtime_status": "VARCHAR DEFAULT 'standby'",
        "parent_agent_id": "VARCHAR",
        "current_activity_summary": "VARCHAR DEFAULT ''",
        "updated_at": "DATETIME",
        "default_runtime_profile_id": "VARCHAR",
    },
    "agent_runs": {
        "tenant_id": "VARCHAR",
        "project_id": "VARCHAR",
        "trigger_type": "VARCHAR DEFAULT 'manual'",
        "trigger_id": "VARCHAR",
        "subject": "VARCHAR DEFAULT ''",
        "tokens_input": "INTEGER DEFAULT 0",
        "tokens_output": "INTEGER DEFAULT 0",
        "result_json": "VARCHAR DEFAULT '{}'",
        "started_at": "DATETIME",
        "completed_at": "DATETIME",
        "task_id": "VARCHAR",
        "workstream_run_id": "VARCHAR",
        "step_id": "VARCHAR",
        "parent_run_id": "VARCHAR",
        "run_role": "VARCHAR DEFAULT 'main'",
        "segment_index": "INTEGER DEFAULT 0",
        "runtime_snapshot_json": "VARCHAR DEFAULT '{}'",
        "checkpoint_json": "VARCHAR DEFAULT '{}'",
        "pause_reason": "VARCHAR",
    },
    "run_events": {
        "sequence": "INTEGER DEFAULT 0",
        "detail_level": "VARCHAR DEFAULT 'summary'",
    },
    "workstream_steps": {
        "agent_id": "VARCHAR",
        "runtime_profile_id": "VARCHAR",
        "step_kind": "VARCHAR DEFAULT 'agent'",
        "prompt_template": "VARCHAR DEFAULT ''",
        "handoff_template": "VARCHAR DEFAULT ''",
        "input_from_steps_json": "VARCHAR DEFAULT '[]'",
        "success_criteria_json": "VARCHAR DEFAULT '{}'",
        "eval_kind": "VARCHAR DEFAULT 'rubric'",
        "on_eval_fail_step": "VARCHAR",
        "max_retries": "INTEGER DEFAULT 2",
    },
    "orchestra_tasks": {
        "action_type": "VARCHAR DEFAULT 'start_task'",
        "action_config_json": "VARCHAR DEFAULT '{}'",
    },
    "blueprint_pages": {
        "is_pinned": "BOOLEAN DEFAULT 0",
        "is_locked": "BOOLEAN DEFAULT 0",
        "content_version": "INTEGER DEFAULT 0",
        "sort_order": "INTEGER DEFAULT 0",
        "icon": "VARCHAR",
        "parent_id": "VARCHAR",
        "updated_at": "DATETIME",
    },
    "blueprint_docs": {
        "updated_at": "DATETIME",
    },
    "blueprint_blocks": {
        "updated_at": "DATETIME",
    },
}


def _sqlite_type(col_type: TypeEngine) -> str:
    name = type(col_type).__name__.lower()
    if "bool" in name:
        return "BOOLEAN DEFAULT 0"
    if "int" in name:
        return "INTEGER"
    if "float" in name or "numeric" in name or "decimal" in name:
        return "REAL"
    if "date" in name or "time" in name:
        return "DATETIME"
    return "VARCHAR"


def _columns_to_add(connection: Connection) -> list[tuple[str, str, str]]:
    import app.models  # noqa: F401 — register tables

    inspector = inspect(connection)
    pending: list[tuple[str, str, str]] = []

    for table_name, table in SQLModel.metadata.tables.items():
        if not inspector.has_table(table_name):
            continue
        existing = {col["name"] for col in inspector.get_columns(table_name)}
        manual = COLUMN_PATCHES.get(table_name, {})
        for col in table.columns:
            if col.name in existing:
                continue
            sql_type = manual.get(col.name) or _sqlite_type(col.type)
            pending.append((table_name, col.name, sql_type))

    for table_name, overrides in COLUMN_PATCHES.items():
        if not inspector.has_table(table_name):
            continue
        existing = {col["name"] for col in inspector.get_columns(table_name)}
        for col_name, sql_type in overrides.items():
            if col_name in existing:
                continue
            pending.append((table_name, col_name, sql_type))

    seen: set[tuple[str, str]] = set()
    unique: list[tuple[str, str, str]] = []
    for table_name, col_name, sql_type in pending:
        key = (table_name, col_name)
        if key in seen:
            continue
        seen.add(key)
        unique.append((table_name, col_name, sql_type))
    return unique


def apply_column_patches(connection: Connection) -> None:
    for table_name, col_name, col_type in _columns_to_add(connection):
        connection.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {col_name} {col_type}"))
