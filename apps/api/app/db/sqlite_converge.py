"""SQLite dev counterparts of Alembic revisions that move data or drop columns.

- 073: ``signals.tags_json`` becomes ``signal_tag_links``.
- 074: ``case_types.show_as_folder`` is dropped.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime

from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection

from app.services.signal_tags import normalize_tag


_RETIRED_COLUMNS = {"case_types": ("show_as_folder",)}


def converge_sqlite_schema(connection: Connection) -> None:
    _tags_to_links(connection)
    inspector = inspect(connection)
    for table, retired in _RETIRED_COLUMNS.items():
        if not inspector.has_table(table):
            continue
        columns = {c["name"] for c in inspector.get_columns(table)}
        for column in retired:
            if column in columns:
                connection.execute(text(f"ALTER TABLE {table} DROP COLUMN {column}"))


def _tags_to_links(connection: Connection) -> None:
    columns = {c["name"] for c in inspect(connection).get_columns("signals")}
    if "tags_json" not in columns:
        return
    registry = {
        (row["tenant_id"], row["name"]): row["id"]
        for row in connection.execute(text("SELECT id, tenant_id, name FROM signal_tags")).mappings()
    }
    now = datetime.utcnow()
    rows = connection.execute(
        text(
            "SELECT id, tenant_id, tags_json FROM signals "
            "WHERE tags_json IS NOT NULL AND tags_json NOT IN ('', '[]')"
        )
    ).mappings().all()
    for row in rows:
        try:
            names = json.loads(row["tags_json"] or "[]")
        except (json.JSONDecodeError, TypeError):
            continue
        seen: set[str] = set()
        for raw in names if isinstance(names, list) else []:
            name = normalize_tag(raw)
            if not name or name in seen:
                continue
            seen.add(name)
            key = (row["tenant_id"], name)
            tag_id = registry.get(key)
            if tag_id is None:
                tag_id = uuid.uuid4().hex
                connection.execute(
                    text(
                        "INSERT INTO signal_tags (id, tenant_id, name, description, created_at, updated_at) "
                        "VALUES (:id, :tenant_id, :name, '', :now, :now)"
                    ),
                    {"id": tag_id, "tenant_id": row["tenant_id"], "name": name, "now": now},
                )
                registry[key] = tag_id
            connection.execute(
                text(
                    "INSERT OR IGNORE INTO signal_tag_links (signal_id, tag_id, tenant_id, created_at) "
                    "VALUES (:sid, :tid, :tenant_id, :now)"
                ),
                {"sid": row["id"], "tid": tag_id, "tenant_id": row["tenant_id"], "now": now},
            )
    connection.execute(text("ALTER TABLE signals DROP COLUMN tags_json"))
