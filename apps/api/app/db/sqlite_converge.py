"""SQLite dev counterparts of Alembic revisions that move data or drop columns.

- 073: ``signals.tags_json`` becomes ``signal_tag_links``.
- 075: categories and tickets live on hashtags and conversations. Case types
  become ``signal_tags`` with a playbook, cases become ``signals.ticket_*``,
  playbook projects move to ``workstream_projects``; ``cases``,
  ``case_types`` and ``inbox_folders`` are dropped.
- 079: partial unique index on ``integration_connections.instance_key``.
- 090: hashtag words join with ``_``; duplicate names merge; folder names follow the tag.
"""

from __future__ import annotations

import json
import uuid
from collections import Counter
from datetime import datetime

from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection

from app.services.signal_tags import normalize_tag


_DROPPED_TABLES = (
    "cases",
    "case_type_fields",
    "case_type_bindings",
    "case_types",
    "inbox_folders",
    # 101_drop_dead_schema
    "channel_bindings",
    "eval_checkpoints",
    "os_canvas_edges",
    "os_canvas_nodes",
    "operational_outcomes",
    "custom_record_comments",
    "custom_record_activities",
    "custom_views",
    "custom_records",
    "custom_fields",
    "custom_tables",
    # 102_drop_workstream_runs
    "workstream_runs",
)

# 103_signal_owner_slim — old ownership columns dropped after backfill.
_RETIRED_SIGNAL_OWNER_COLUMNS = (
    "assigned_user_id",
    "assignee_team_id",
    "turn_user_id",
    "turn_team_id",
    "last_human_owner_kind",
    "last_human_owner_user_id",
    "last_human_owner_team_id",
    "active_turn_json",
    "handoff_session_json",
)

_RETIRED_STEP_COLUMNS = (
    ("workstream_runs", "current_step_id"),
    ("agent_runs", "step_id"),
    ("agent_tasks", "current_step_id"),
    ("agent_tasks", "step_id"),
)

# SQLite refuses DROP COLUMN on some legacy columns; those stay as unused
# orphans in dev databases while Alembic drops them on Postgres.
_RETIRED_COLUMNS = {
    "workstreams": ("project_id", "is_default"),
    # 088: pinned folded into show_in_nav.
    "signal_tags": ("pinned",),
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
    "show_in_nav": "0",
    "ai_auto_tag": "1",
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
    _pinned_to_nav(connection)
    _normalize_tag_names(connection)
    _workstream_projects(connection)
    _cases_to_tickets(connection)
    _connection_instance_index(connection)
    _tenant_calendars(connection)
    inspector = inspect(connection)
    for table in _DROPPED_TABLES:
        if inspector.has_table(table):
            connection.execute(text(f"DROP TABLE {table}"))
    inspector = inspect(connection)
    for table, column in _RETIRED_STEP_COLUMNS:
        if not inspector.has_table(table):
            continue
        columns = {c["name"] for c in inspector.get_columns(table)}
        if column not in columns:
            continue
        try:
            connection.execute(text(f"ALTER TABLE {table} DROP COLUMN {column}"))
        except Exception:  # noqa: BLE001
            pass
    if inspector.has_table("signals"):
        signal_cols = {c["name"] for c in inspector.get_columns("signals")}
        for column in _RETIRED_SIGNAL_OWNER_COLUMNS:
            if column not in signal_cols:
                continue
            try:
                connection.execute(text(f"ALTER TABLE signals DROP COLUMN {column}"))
            except Exception:  # noqa: BLE001
                pass
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


def _tenant_calendars(connection: Connection) -> None:
    """092: tenant_calendar_id on events + backfill from connection meta."""
    inspector = inspect(connection)
    if not inspector.has_table("calendar_events"):
        return
    cols = {c["name"] for c in inspector.get_columns("calendar_events")}
    if "tenant_calendar_id" not in cols:
        connection.execute(text("ALTER TABLE calendar_events ADD COLUMN tenant_calendar_id VARCHAR"))
        connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_calendar_events_tenant_calendar_id "
                "ON calendar_events (tenant_calendar_id)"
            )
        )
    if not inspector.has_table("tenant_calendars"):
        return
    now = datetime.utcnow().isoformat(sep=" ")
    rows = connection.execute(
        text(
            "SELECT id, tenant_id, provider, metadata_json FROM integration_connections "
            "WHERE status = 'active'"
        )
    ).mappings().all()
    for row in rows:
        provider = str(row["provider"] or "")
        if "calendar" not in provider and provider not in ("google", "outlook"):
            continue
        try:
            meta = json.loads(row["metadata_json"] or "{}")
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(meta, dict):
            continue
        calendars = meta.get("calendars")
        if not isinstance(calendars, list):
            continue
        for item in calendars:
            if not isinstance(item, dict) or not item.get("id"):
                continue
            external_id = str(item["id"])
            existing = connection.execute(
                text(
                    "SELECT id FROM tenant_calendars "
                    "WHERE connection_id = :cid AND external_id = :eid"
                ),
                {"cid": str(row["id"]), "eid": external_id},
            ).first()
            if existing:
                cal_id = existing[0]
            else:
                cal_id = str(uuid.uuid4())
                connection.execute(
                    text(
                        "INSERT INTO tenant_calendars ("
                        "id, tenant_id, connection_id, external_id, name, color, "
                        "is_primary, writable, sync_enabled, access_json, created_at, updated_at"
                        ") VALUES ("
                        ":id, :tenant_id, :connection_id, :external_id, :name, :color, "
                        ":is_primary, :writable, :sync_enabled, '[]', :now, :now"
                        ")"
                    ),
                    {
                        "id": cal_id,
                        "tenant_id": str(row["tenant_id"]),
                        "connection_id": str(row["id"]),
                        "external_id": external_id,
                        "name": str(item.get("name") or external_id),
                        "color": str(item.get("color") or ""),
                        "is_primary": 1 if item.get("primary") else 0,
                        "writable": 1 if item.get("writable") else 0,
                        "sync_enabled": 1 if item.get("enabled") else 0,
                        "now": now,
                    },
                )
            connection.execute(
                text(
                    "UPDATE calendar_events SET tenant_calendar_id = :cal_id "
                    "WHERE connection_id = :cid AND calendar_id = :eid "
                    "AND (tenant_calendar_id IS NULL OR tenant_calendar_id = '')"
                ),
                {"cal_id": cal_id, "cid": str(row["id"]), "eid": external_id},
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


def _pinned_to_nav(connection: Connection) -> None:
    """088: a pinned free tag is a workspace-default rail row."""
    columns = {c["name"] for c in inspect(connection).get_columns("signal_tags")}
    if "pinned" in columns and "show_in_nav" in columns:
        connection.execute(text("UPDATE signal_tags SET show_in_nav = 1 WHERE pinned = 1"))


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
    inspector = inspect(connection)
    if inspector.has_table("project_tag_links"):
        connection.execute(
            text(
                "INSERT OR IGNORE INTO project_tag_links "
                "(project_id, tag_id, tenant_id, sort_order, created_at) "
                "SELECT project_id, :target, tenant_id, sort_order, created_at "
                "FROM project_tag_links WHERE tag_id = :source"
            ),
            {"source": source_id, "target": target_id},
        )
        connection.execute(
            text("DELETE FROM project_tag_links WHERE tag_id = :source"),
            {"source": source_id},
        )
    elif inspector.has_table("projects"):
        cols = {c["name"] for c in inspector.get_columns("projects")}
        if "tag_id" in cols:
            connection.execute(
                text("UPDATE projects SET tag_id = :target WHERE tag_id = :source"),
                {"source": source_id, "target": target_id},
            )
    for table, owner in (("contact_tag_links", "contact_id"), ("company_tag_links", "company_id")):
        if not inspector.has_table(table):
            continue
        connection.execute(
            text(
                f"INSERT OR IGNORE INTO {table} ({owner}, tag_id, tenant_id, created_at) "
                f"SELECT {owner}, :target, tenant_id, created_at FROM {table} WHERE tag_id = :source"
            ),
            {"source": source_id, "target": target_id},
        )
        connection.execute(text(f"DELETE FROM {table} WHERE tag_id = :source"), {"source": source_id})
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
    # Folder names are independent of a single tag once filtersets are in use.


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
