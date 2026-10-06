"""SQLite dev counterparts of Alembic revisions that move data or drop columns.

- 073: ``signals.tags_json`` becomes ``signal_tag_links``.
- 075: categories and tickets live on hashtags and conversations. Case types
  become ``signal_tags`` with a playbook, cases become ``signals.ticket_*``,
  playbook projects move to ``workstream_projects``; ``cases``,
  ``case_types`` and ``inbox_folders`` are dropped.
- 079: partial unique index on ``integration_connections.instance_key``.
"""

from __future__ import annotations

import json
import uuid
from collections import Counter
from datetime import datetime

from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection

from app.services.signal_tags import normalize_tag


_DROPPED_TABLES = ("cases", "case_type_fields", "case_type_bindings", "case_types", "inbox_folders")

# SQLite refuses DROP COLUMN on some legacy columns; those stay as unused
# orphans in dev databases while Alembic drops them on Postgres.
_RETIRED_COLUMNS = {
    "workstreams": ("project_id", "is_default"),
    "agent_runs": ("signal_type_id",),
    "usage_ledger": ("signal_type_id",),
    "work_jobs": ("case_id",),
}

_SEED_NAMES = {
    "complaint": "klacht",
    "bug_report": "storing",
    "spam_abuse": "spam",
    "feature_request": "functieverzoek",
    "invoice_payment": "factuur",
}

_TAG_DEFAULTS = {
    "pinned": "0",
    "show_in_nav": "0",
    "create_mode": "'ask_customer'",
    "ask_threshold": "6",
    "auto_threshold": "9",
    "send_mode": "'draft'",
    "autonomy_level": "'assisted'",
    "requires_verification": "0",
    "module_slug": "''",
    "template_slug": "''",
    "sort_order": "0",
}


def converge_sqlite_schema(connection: Connection) -> None:
    _tags_to_links(connection)
    _fill_tag_defaults(connection)
    _normalize_tag_names(connection)
    _workstream_projects(connection)
    _cases_to_tickets(connection)
    _connection_instance_index(connection)
    inspector = inspect(connection)
    for table in _DROPPED_TABLES:
        if inspector.has_table(table):
            connection.execute(text(f"DROP TABLE {table}"))
    inspector = inspect(connection)
    for table, retired in _RETIRED_COLUMNS.items():
        if not inspector.has_table(table):
            continue
        columns = {c["name"] for c in inspector.get_columns(table)}
        for index in inspector.get_indexes(table):
            if set(index["column_names"]) & set(retired):
                connection.execute(text(f"DROP INDEX IF EXISTS {index['name']}"))
        for column in retired:
            if column in columns:
                try:
                    connection.execute(text(f"ALTER TABLE {table} DROP COLUMN {column}"))
                except Exception:  # noqa: BLE001
                    pass


def _connection_instance_index(connection: Connection) -> None:
    """079: partial unique index on existing dev tables (create_all skips them)."""
    inspector = inspect(connection)
    if not inspector.has_table("integration_connections"):
        return
    columns = {c["name"] for c in inspector.get_columns("integration_connections")}
    if "instance_key" not in columns:
        return
    connection.execute(
        text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_integration_connection_instance "
            "ON integration_connections (tenant_id, provider, instance_key) "
            "WHERE instance_key <> '' AND status = 'active'"
        )
    )


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


def _fill_tag_defaults(connection: Connection) -> None:
    columns = {c["name"] for c in inspect(connection).get_columns("signal_tags")}
    for column, value in _TAG_DEFAULTS.items():
        if column in columns:
            connection.execute(
                text(f"UPDATE signal_tags SET {column} = {value} WHERE {column} IS NULL")
            )


def _merge_tag(connection: Connection, source_id: str, target_id: str) -> None:
    connection.execute(
        text(
            "INSERT OR IGNORE INTO signal_tag_links (signal_id, tag_id, tenant_id, created_at) "
            "SELECT signal_id, :target, tenant_id, created_at FROM signal_tag_links WHERE tag_id = :source"
        ),
        {"source": source_id, "target": target_id},
    )
    connection.execute(text("DELETE FROM signal_tag_links WHERE tag_id = :source"), {"source": source_id})
    connection.execute(
        text("UPDATE signals SET ticket_tag_id = :target WHERE ticket_tag_id = :source"),
        {"source": source_id, "target": target_id},
    )
    connection.execute(text("DELETE FROM signal_tags WHERE id = :source"), {"source": source_id})


def _normalize_tag_names(connection: Connection) -> None:
    rows = connection.execute(
        text("SELECT id, tenant_id, name FROM signal_tags ORDER BY created_at")
    ).mappings().all()
    by_name: dict[tuple[str, str], str] = {}
    for row in rows:
        clean = normalize_tag(row["name"]) or "tag"
        key = (row["tenant_id"], clean)
        if key in by_name:
            _merge_tag(connection, row["id"], by_name[key])
            continue
        by_name[key] = row["id"]
        if clean != row["name"]:
            connection.execute(
                text("UPDATE signal_tags SET name = :name WHERE id = :id"),
                {"name": clean, "id": row["id"]},
            )


def _workstream_projects(connection: Connection) -> None:
    columns = {c["name"] for c in inspect(connection).get_columns("workstreams")}
    if "project_id" not in columns:
        return
    has_default = "is_default" in columns
    now = datetime.utcnow()
    rows = connection.execute(
        text(
            "SELECT id, tenant_id, project_id"
            + (", is_default" if has_default else "")
            + " FROM workstreams WHERE project_id IS NOT NULL"
        )
    ).mappings().all()
    for row in rows:
        connection.execute(
            text(
                "INSERT OR IGNORE INTO workstream_projects "
                "(workstream_id, project_id, tenant_id, is_default, position, created_at) "
                "VALUES (:ws, :project, :tenant, :is_default, 0, :now)"
            ),
            {
                "ws": row["id"],
                "project": row["project_id"].replace("-", ""),
                "tenant": row["tenant_id"],
                "is_default": bool(row.get("is_default")) if has_default else False,
                "now": now,
            },
        )
    connection.execute(text("UPDATE workstreams SET project_id = NULL"))


def _ticket_status(case_status: str) -> str:
    if case_status in ("proposed", "open", "waiting", "done"):
        return case_status
    if case_status in ("closed", "resolved"):
        return "done"
    return ""


def _cases_to_tickets(connection: Connection) -> None:
    inspector = inspect(connection)
    if not inspector.has_table("case_types"):
        return
    now = datetime.utcnow()
    types = connection.execute(
        text("SELECT * FROM case_types WHERE deleted_at IS NULL ORDER BY sort_order")
    ).mappings().all()
    playbook_by_type: dict[str, str] = {}
    if inspector.has_table("case_type_bindings"):
        for row in connection.execute(
            text(
                "SELECT case_type_id, target_id FROM case_type_bindings "
                "WHERE target_kind = 'workstream' AND enabled = 1 ORDER BY priority"
            )
        ).mappings():
            playbook_by_type.setdefault(row["case_type_id"], row["target_id"].replace("-", ""))
    has_cases = inspector.has_table("cases")
    case_rows = (
        connection.execute(text("SELECT * FROM cases ORDER BY created_at")).mappings().all()
        if has_cases
        else []
    )
    run_ws: Counter[tuple[str, str]] = Counter(
        (row["case_type_id"], row["workstream_id"].replace("-", ""))
        for row in case_rows
        if row["workstream_id"]
    )
    for (type_id, ws_id), _ in run_ws.most_common():
        playbook_by_type.setdefault(type_id, ws_id)

    tag_by_type: dict[str, str] = {}
    for ct in types:
        name = _SEED_NAMES.get(ct["slug"]) or normalize_tag(ct["name"]) or normalize_tag(ct["slug"])
        existing = connection.execute(
            text("SELECT id, workstream_id FROM signal_tags WHERE tenant_id = :t AND name = :n"),
            {"t": ct["tenant_id"], "n": name},
        ).mappings().first()
        tag_id = existing["id"] if existing else uuid.uuid4().hex
        if existing is None:
            connection.execute(
                text(
                    "INSERT INTO signal_tags (id, tenant_id, name, description, created_at, updated_at) "
                    "VALUES (:id, :t, :n, :d, :now, :now)"
                ),
                {"id": tag_id, "t": ct["tenant_id"], "n": name, "d": ct["description"] or "", "now": now},
            )
        playbook = playbook_by_type.get(ct["id"])
        connection.execute(
            text(
                "UPDATE signal_tags SET description = CASE WHEN description = '' THEN :d ELSE description END, "
                "create_mode = :create_mode, ask_threshold = :ask, auto_threshold = :auto, "
                "send_mode = :send_mode, autonomy_level = :autonomy, "
                "requires_verification = :verify, module_slug = :module, template_slug = :template, "
                "sort_order = :sort, "
                "workstream_id = COALESCE(workstream_id, :ws), "
                "show_in_nav = CASE WHEN :ws IS NOT NULL THEN 1 ELSE show_in_nav END "
                "WHERE id = :id"
            ),
            {
                "id": tag_id,
                "d": ct["description"] or "",
                "create_mode": ct["create_mode"] or "ask_customer",
                "ask": ct["ask_threshold"] if ct["ask_threshold"] is not None else 6,
                "auto": ct["auto_threshold"] if ct["auto_threshold"] is not None else 9,
                "send_mode": ct.get("send_mode") or "draft",
                "autonomy": ct.get("autonomy_level") or "assisted",
                "verify": bool(ct["requires_verification"]),
                "module": ct["module_slug"] or "",
                "template": ct["template_slug"] or "",
                "sort": ct["sort_order"] or 0,
                "ws": playbook,
            },
        )
        tag_by_type[ct["id"]] = tag_id
        default_project = ct.get("default_project_id")
        if playbook and default_project:
            connection.execute(
                text(
                    "INSERT OR IGNORE INTO workstream_projects "
                    "(workstream_id, project_id, tenant_id, is_default, position, created_at) "
                    "VALUES (:ws, :project, :t, 0, 0, :now)"
                ),
                {"ws": playbook, "project": default_project.replace("-", ""), "t": ct["tenant_id"], "now": now},
            )

    filed: set[str] = set()
    for case in reversed(case_rows):
        tag_id = tag_by_type.get(case["case_type_id"])
        if tag_id is None:
            continue
        status = _ticket_status(case["status"] or "")
        is_category = case["case_type_id"] in playbook_by_type
        if not is_category or not status or case["signal_id"] in filed:
            connection.execute(
                text(
                    "INSERT OR IGNORE INTO signal_tag_links (signal_id, tag_id, tenant_id, created_at) "
                    "VALUES (:sid, :tid, :t, :now)"
                ),
                {"sid": case["signal_id"], "tid": tag_id, "t": case["tenant_id"], "now": now},
            )
            continue
        filed.add(case["signal_id"])
        connection.execute(
            text(
                "UPDATE signals SET ticket_tag_id = :tid, ticket_status = :status, "
                "stage_key = :stage, ticket_certainty = :certainty, ticket_filed_at = :filed, "
                "project_id = COALESCE(:project, project_id) WHERE id = :sid"
            ),
            {
                "tid": tag_id,
                "status": status,
                "stage": case.get("stage_key") or "",
                "certainty": case["certainty"],
                "filed": case["created_at"],
                "project": case["project_id"],
                "sid": case["signal_id"],
            },
        )
        if case["workstream_run_id"]:
            connection.execute(
                text(
                    "UPDATE workstream_runs SET input_kind = 'ticket', input_ref = :ref, "
                    "signal_id = :sid WHERE id = :run"
                ),
                {"ref": str(uuid.UUID(case["signal_id"])), "sid": case["signal_id"], "run": case["workstream_run_id"]},
            )

    for table in ("agent_runs", "usage_ledger"):
        columns = {c["name"] for c in inspector.get_columns(table)}
        if "signal_type_id" in columns and "ticket_tag_id" in columns:
            for type_id, tag_id in tag_by_type.items():
                connection.execute(
                    text(f"UPDATE {table} SET ticket_tag_id = :tag WHERE signal_type_id IN (:a, :b)"),
                    {"tag": tag_id, "a": type_id, "b": str(uuid.UUID(type_id))},
                )
            connection.execute(text(f"UPDATE {table} SET signal_type_id = NULL"))
    if "case_id" in {c["name"] for c in inspector.get_columns("work_jobs")}:
        connection.execute(text("UPDATE work_jobs SET case_id = NULL"))
    if inspector.has_table("trash_entries"):
        connection.execute(
            text("DELETE FROM trash_entries WHERE resource_type IN ('case_type', 'case_type_binding')")
        )
    if inspector.has_table("platform_changes"):
        connection.execute(
            text(
                "UPDATE platform_changes SET status = 'rejected' "
                "WHERE resource_type IN ('case_type', 'case_type_binding') "
                "AND status IN ('draft', 'pending_review')"
            )
        )
