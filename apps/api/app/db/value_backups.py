"""Keep values a migration throws away, so its downgrade can put them back.

Migrations that drop a column or a table write the old values to
``schema_value_backups`` first. Only migrations read and write this table;
the app has no model for it. Values are JSON so booleans and numbers keep
their type. ``column_name == "*"`` holds a whole row.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any
from uuid import uuid4

import sqlalchemy as sa

TABLE = "schema_value_backups"
ROW = "*"

_metadata = sa.MetaData()
backups = sa.Table(
    TABLE,
    _metadata,
    sa.Column("id", sa.String(36), primary_key=True),
    sa.Column("revision", sa.String(64), nullable=False, index=True),
    sa.Column("table_name", sa.String(128), nullable=False),
    sa.Column("row_id", sa.String(64), nullable=False),
    sa.Column("column_name", sa.String(128), nullable=False),
    sa.Column("value", sa.Text(), nullable=True),
    sa.Column("tenant_id", sa.String(64), nullable=True),
    sa.Column("created_at", sa.DateTime(), nullable=False),
)


def ensure_table(bind) -> None:
    _metadata.create_all(bind, tables=[backups], checkfirst=True)


def _columns(bind, table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(bind).get_columns(table)}


def _encode(value: Any) -> str:
    return json.dumps(value, default=str)


def write_values(bind, revision: str, table: str, rows: list[tuple[Any, str, Any, Any]]) -> int:
    if not rows:
        return 0
    now = datetime.utcnow()
    bind.execute(
        backups.insert(),
        [
            {
                "id": str(uuid4()),
                "revision": revision,
                "table_name": table,
                "row_id": str(row_id),
                "column_name": column,
                "value": _encode(value),
                "tenant_id": str(tenant_id) if tenant_id is not None else None,
                "created_at": now,
            }
            for row_id, column, value, tenant_id in rows
        ],
    )
    return len(rows)


def backup_column(bind, revision: str, table: str, column: str, where: str = "") -> int:
    """Store ``column`` of every row matching ``where`` (SQL), return the count."""
    ensure_table(bind)
    tenant = "tenant_id" if "tenant_id" in _columns(bind, table) else "NULL"
    sql = f"SELECT id, {column}, {tenant} FROM {table}"
    if where:
        sql += f" WHERE {where}"
    rows = [(r[0], column, r[1], r[2]) for r in bind.execute(sa.text(sql))]
    return write_values(bind, revision, table, rows)


def backup_rows(bind, revision: str, table: str) -> int:
    """Store every row of ``table`` as one JSON object."""
    ensure_table(bind)
    result = bind.execute(sa.text(f"SELECT * FROM {table}"))
    keys = list(result.keys())
    rows = []
    for raw in result:
        data = dict(zip(keys, raw))
        rows.append((data.get("id"), ROW, data, data.get("tenant_id")))
    return write_values(bind, revision, table, rows)


def stored_values(bind, revision: str, table: str, column: str) -> list[tuple[str, Any]]:
    if TABLE not in sa.inspect(bind).get_table_names():
        return []
    rows = bind.execute(
        sa.select(backups.c.row_id, backups.c.value).where(
            backups.c.revision == revision,
            backups.c.table_name == table,
            backups.c.column_name == column,
        )
    ).all()
    return [(row_id, json.loads(value) if value is not None else None) for row_id, value in rows]


def restore_column(bind, revision: str, table: str, column: str) -> int:
    """Write the stored values back into ``column``; return the count."""
    rows = stored_values(bind, revision, table, column)
    for row_id, value in rows:
        bind.execute(
            sa.text(f"UPDATE {table} SET {column} = :value WHERE CAST(id AS TEXT) = :id"),
            {"value": value, "id": row_id},
        )
    return len(rows)


def stored_rows(bind, revision: str, table: str) -> list[dict]:
    return [value for _row_id, value in stored_values(bind, revision, table, ROW) if isinstance(value, dict)]


def _coerce(column: sa.Column, value: Any) -> Any:
    if value is None:
        return None
    if isinstance(column.type, sa.DateTime) and isinstance(value, str):
        return datetime.fromisoformat(value)
    if isinstance(column.type, sa.Uuid) and isinstance(value, str):
        from uuid import UUID

        return UUID(value)
    return value


def restore_rows(bind, revision: str, table: str) -> int:
    """Insert the stored rows of ``table`` again (the table must exist)."""
    rows = stored_rows(bind, revision, table)
    if not rows:
        return 0
    target = sa.Table(table, sa.MetaData(), autoload_with=bind, resolve_fks=False)
    payload = [
        {name: _coerce(target.c[name], value) for name, value in row.items() if name in target.c}
        for row in rows
    ]
    bind.execute(target.insert(), payload)
    return len(payload)


def clear(bind, revision: str) -> None:
    if TABLE in sa.inspect(bind).get_table_names():
        bind.execute(backups.delete().where(backups.c.revision == revision))
