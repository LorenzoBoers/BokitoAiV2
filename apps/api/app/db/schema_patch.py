"""FROZEN legacy schema patches — do not add new ALTERs or repairs here.

As of Alembic revision `003_baseline` the Postgres schema is Alembic-managed:
every new schema change must be a new revision in `alembic/versions/`. This
module remains only because (a) `003_baseline` replays it to converge existing
databases and (b) SQLite (tests/local dev) still runs it via `init_db`.

Historical purpose: add missing columns on existing SQLite/Postgres tables
(create_all does not ALTER) plus idempotent data repairs.
"""

from __future__ import annotations

import json
import logging
import uuid

from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection
from sqlalchemy.exc import DBAPIError
from sqlalchemy.types import TypeEngine
from sqlmodel import SQLModel

logger = logging.getLogger(__name__)

# Manual overrides when auto-inference is insufficient (table -> column -> SQL fragment)
COLUMN_PATCHES: dict[str, dict[str, str]] = {
    "users": {
        "job_title": "VARCHAR DEFAULT ''",
        "avatar_url": "VARCHAR",
        "is_staff": "BOOLEAN DEFAULT 0",
        "email_verified": "BOOLEAN DEFAULT 0",
        "settings_json": "VARCHAR DEFAULT '{}'",
    },
    "invites": {
        "invited_by_user_id": "VARCHAR",
    },
    "agents": {
        "slug": "VARCHAR DEFAULT ''",
        "runtime_status": "VARCHAR DEFAULT 'standby'",
        "parent_agent_id": "VARCHAR",
        "current_activity_summary": "VARCHAR DEFAULT ''",
        "updated_at": "DATETIME",
        "default_runtime_profile_id": "VARCHAR",
        "kind": "VARCHAR DEFAULT 'company'",
        "owner_user_id": "VARCHAR",
        "chat_access": "VARCHAR DEFAULT 'nobody'",
        "settings_json": "VARCHAR DEFAULT '{}'",
    },
    "signals": {
        "agent_id": "VARCHAR",
        "context_signal_id": "VARCHAR",
        "snoozed_until": "DATETIME",
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
}


def _is_uuid_type(col_type: TypeEngine) -> bool:
    name = type(col_type).__name__.lower()
    return "uuid" in name or "guid" in name


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
    if _is_uuid_type(col_type):
        # Translated per dialect in _dialect_ddl: native UUID on Postgres so
        # joins against uuid primary keys keep working, VARCHAR on SQLite.
        return "UUID"
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


def _dialect_ddl(col_type: str, is_postgres: bool) -> str:
    """Translate SQLite-flavored column DDL fragments to Postgres equivalents.

    These patches only run as ADD COLUMN on pre-existing tables that are missing
    a column; on a fresh database create_all already builds every column so they
    are no-ops. The translation keeps them safe if ever executed on Postgres
    (e.g. `BOOLEAN DEFAULT 0` is invalid there)."""
    if not is_postgres:
        return col_type.replace("UUID", "VARCHAR")
    return (
        col_type.replace("BOOLEAN DEFAULT 0", "BOOLEAN DEFAULT false")
        .replace("BOOLEAN DEFAULT 1", "BOOLEAN DEFAULT true")
        .replace("DATETIME", "TIMESTAMP")
    )


def apply_column_patches(connection: Connection) -> None:
    is_postgres = connection.dialect.name == "postgresql"
    for table_name, col_name, col_type in _columns_to_add(connection):
        ddl = _dialect_ddl(col_type, is_postgres)
        connection.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {col_name} {ddl}"))


def _rows(connection: Connection, sql: str) -> list:
    return list(connection.execute(text(sql)).mappings())


def _migrate_legacy_threads_to_signals(connection: Connection) -> None:
    """One-time migration: conversations / inbox_threads / email_threads -> signals.

    Runs only while the legacy tables still exist; drops them afterwards so the
    migration is naturally idempotent.
    """
    inspector = inspect(connection)
    if not inspector.has_table("signals"):
        return

    signal_cols = {c["name"] for c in inspector.get_columns("signals")}
    if "channel_account_id" not in signal_cols:
        return

    # --- email_accounts -> channel_accounts (preserve ids) ---
    if inspector.has_table("email_accounts") and inspector.has_table("channel_accounts"):
        existing_accounts = {
            str(r["id"]) for r in _rows(connection, "SELECT id FROM channel_accounts")
        }
        for row in _rows(connection, "SELECT * FROM email_accounts"):
            if str(row["id"]) in existing_accounts:
                continue
            connection.execute(
                text(
                    "INSERT INTO channel_accounts "
                    "(id, tenant_id, connection_id, channel, provider, address, display_name,"
                    " is_enabled, sync_cursor, credentials_json, settings_json, created_at) "
                    "VALUES (:id, :tenant_id, :connection_id, 'email', :provider, :address, '',"
                    " :is_enabled, :sync_cursor, '{}', '{}', :created_at)"
                ),
                {
                    "id": row["id"],
                    "tenant_id": row["tenant_id"],
                    "connection_id": row["connection_id"],
                    "provider": row["provider"],
                    "address": row["email_address"],
                    "is_enabled": row["is_enabled"],
                    "sync_cursor": row["sync_cursor"],
                    "created_at": row["created_at"],
                },
            )
        if "email_account_id" in signal_cols:
            connection.execute(
                text(
                    "UPDATE signals SET channel_account_id = email_account_id "
                    "WHERE channel_account_id IS NULL AND email_account_id IS NOT NULL"
                )
            )

    # --- conversations -> signals (assistant / widget threads, ids preserved) ---
    if inspector.has_table("conversations"):
        existing_signals = {str(r["id"]) for r in _rows(connection, "SELECT id FROM signals")}
        for row in _rows(connection, "SELECT * FROM conversations"):
            if str(row["id"]) in existing_signals:
                continue
            channel = "widget" if row["channel"] == "customer_widget" else "assistant"
            connection.execute(
                text(
                    "INSERT INTO signals "
                    "(id, tenant_id, channel, source, external_id, owner_user_id, subject,"
                    " contact_name, contact_email, contact_phone, status, priority, tags_json,"
                    " has_unread, ai_paused, assigned_user_id, summary,"
                    " last_message_at, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :channel, 'chat', '', :owner_user_id, :subject,"
                    " '', '', '', 'open', 'normal', '[]',"
                    " 0, :ai_paused, :assigned_user_id, '',"
                    " :last_message_at, :created_at, :updated_at)"
                ),
                {
                    "id": row["id"],
                    "tenant_id": row["tenant_id"],
                    "channel": channel,
                    "owner_user_id": row["user_id"],
                    "subject": row["title"],
                    "ai_paused": row["ai_paused"],
                    "assigned_user_id": row["assigned_user_id"],
                    "last_message_at": row["last_message_at"],
                    "created_at": row["created_at"],
                    "updated_at": row["updated_at"],
                },
            )
        if inspector.has_table("conversation_messages"):
            for row in _rows(connection, "SELECT * FROM conversation_messages"):
                role = row["role"]
                kind = "user_message" if role == "user" else "agent_message"
                direction = "inbound" if role == "user" else "outbound"
                connection.execute(
                    text(
                        "INSERT INTO signal_messages "
                        "(id, signal_id, tenant_id, kind, direction, role, from_address,"
                        " to_addresses, subject, body_text, body_html, body_preview, external_id,"
                        " attachments_json, metadata_json, certainty, auto_sent, decision_id,"
                        " created_at) "
                        "VALUES (:id, :signal_id, :tenant_id, :kind, :direction, :role, '',"
                        " '[]', '', :body_text, '', :body_preview, '',"
                        " :attachments_json, :metadata_json, :certainty, :auto_sent, :decision_id,"
                        " :created_at)"
                    ),
                    {
                        "id": row["id"],
                        "signal_id": row["conversation_id"],
                        "tenant_id": row["tenant_id"],
                        "kind": kind,
                        "direction": direction,
                        "role": role if role in ("user", "assistant", "system") else "user",
                        "body_text": row["content"],
                        "body_preview": (row["content"] or "")[:200],
                        "attachments_json": row["attachments_json"] or "[]",
                        "metadata_json": row["metadata_json"] or "{}",
                        "certainty": row["certainty"],
                        "auto_sent": row["auto_sent"],
                        "decision_id": row["decision_request_id"],
                        "created_at": row["created_at"],
                    },
                )

    # Decision requests created inline in chat keep their thread link.
    if inspector.has_table("decision_requests"):
        dr_cols = {c["name"] for c in inspector.get_columns("decision_requests")}
        if "conversation_id" in dr_cols and "signal_id" in dr_cols:
            connection.execute(
                text(
                    "UPDATE decision_requests SET signal_id = conversation_id "
                    "WHERE signal_id IS NULL AND conversation_id IS NOT NULL"
                )
            )

    # --- email_threads -> signals (ids preserved) ---
    if inspector.has_table("email_threads"):
        existing_signals = {str(r["id"]) for r in _rows(connection, "SELECT id FROM signals")}
        for row in _rows(connection, "SELECT * FROM email_threads"):
            if str(row["id"]) in existing_signals:
                continue
            connection.execute(
                text(
                    "INSERT INTO signals "
                    "(id, tenant_id, channel, source, external_id, channel_account_id, subject,"
                    " contact_name, contact_email, contact_phone, status, priority, tags_json,"
                    " has_unread, ai_paused, summary, last_message_at, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, 'email', 'email', :external_id, :account_id, :subject,"
                    " '', '', '', 'open', 'normal', '[]',"
                    " :has_unread, 0, '', :updated_at, :created_at, :updated_at)"
                ),
                {
                    "id": row["id"],
                    "tenant_id": row["tenant_id"],
                    "external_id": row["external_id"] or "",
                    "account_id": row["account_id"],
                    "subject": row["subject"] or "(No subject)",
                    "has_unread": row["has_unread"],
                    "created_at": row["created_at"],
                    "updated_at": row["updated_at"],
                },
            )
        if inspector.has_table("email_messages"):
            for row in _rows(connection, "SELECT * FROM email_messages"):
                connection.execute(
                    text(
                        "INSERT INTO signal_messages "
                        "(id, signal_id, tenant_id, kind, direction, role, from_address,"
                        " to_addresses, subject, body_text, body_html, body_preview, external_id,"
                        " attachments_json, metadata_json, auto_sent, created_at) "
                        "VALUES (:id, :signal_id, :tenant_id, 'user_message', :direction, :role,"
                        " :from_address, :to_addresses, :subject, :body_text, :body_html,"
                        " :body_preview, :external_id, '[]', '{}', 0, :created_at)"
                    ),
                    {
                        "id": row["id"],
                        "signal_id": row["thread_id"],
                        "tenant_id": row["tenant_id"],
                        "direction": row["direction"],
                        "role": "user" if row["direction"] == "inbound" else "assistant",
                        "from_address": row["from_address"] or "",
                        "to_addresses": row["to_addresses"] or "[]",
                        "subject": row["subject"] or "",
                        "body_text": row["body_text"] or "",
                        "body_html": row["body_html"] or "",
                        "body_preview": (row["body_text"] or "")[:200],
                        "external_id": row["external_id"] or "",
                        "created_at": row["created_at"],
                    },
                )

    # --- inbox_threads -> signals (integer pks; new uuids) ---
    if inspector.has_table("inbox_threads"):
        for row in _rows(connection, "SELECT * FROM inbox_threads"):
            new_id = str(uuid.uuid4())
            connection.execute(
                text(
                    "INSERT INTO signals "
                    "(id, tenant_id, channel, source, external_id, subject, contact_name,"
                    " contact_email, contact_phone, status, priority, tags_json, has_unread,"
                    " ai_paused, summary, last_message_at, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :channel, 'inbox', :external_id, :subject,"
                    " :contact_name, :contact_email, :contact_phone, :status, :priority,"
                    " :tags_json, :has_unread, 0, '', :last_message_at, :created_at, :created_at)"
                ),
                {
                    "id": new_id,
                    "tenant_id": row["tenant_id"],
                    "channel": row["channel"] or "email",
                    "external_id": row["graph_conversation_id"] or "",
                    "subject": row["email_subject"] or "(No subject)",
                    "contact_name": row["contact_name"] or "",
                    "contact_email": row["contact_email"] or "",
                    "contact_phone": row["contact_phone"] or "",
                    "status": row["status"] or "open",
                    "priority": row["priority"] or "normal",
                    "tags_json": row["tags_json"] or "[]",
                    "has_unread": row["has_unread"],
                    "last_message_at": row["last_message_at"],
                    "created_at": row["created_at"],
                },
            )
            if inspector.has_table("inbox_messages"):
                for msg in _rows(
                    connection,
                    f"SELECT * FROM inbox_messages WHERE thread_id = {int(row['id'])}",
                ):
                    connection.execute(
                        text(
                            "INSERT INTO signal_messages "
                            "(id, signal_id, tenant_id, kind, direction, role, from_address,"
                            " to_addresses, subject, body_text, body_html, body_preview,"
                            " external_id, attachments_json, metadata_json, auto_sent,"
                            " send_status, received_at, created_at) "
                            "VALUES (:id, :signal_id, :tenant_id, :kind, :direction, :role,"
                            " :from_address, :to_addresses, :subject, :body_text, :body_html,"
                            " :body_preview, :external_id, :attachments_json, '{}', 0,"
                            " :send_status, :received_at, :created_at)"
                        ),
                        {
                            "id": str(uuid.uuid4()),
                            "signal_id": new_id,
                            "tenant_id": msg["tenant_id"],
                            "kind": "internal_note" if msg["direction"] == "internal" else "user_message",
                            "direction": msg["direction"] or "inbound",
                            "role": "user" if msg["direction"] == "inbound" else "assistant",
                            "from_address": msg["from_address"] or "",
                            "to_addresses": json.dumps([msg["to_addresses"]]) if msg["to_addresses"] else "[]",
                            "subject": msg["subject"] or "",
                            "body_text": msg["body_preview"] or "",
                            "body_html": msg["body_html"] or "",
                            "body_preview": (msg["body_preview"] or "")[:200],
                            "external_id": msg["graph_message_id"] or "",
                            "attachments_json": msg["attachments_json"] or "[]",
                            "send_status": msg["send_status"],
                            "received_at": msg["received_at"],
                            "created_at": msg["created_at"],
                        },
                    )

    # --- drop legacy tables ---
    cascade = " CASCADE" if connection.dialect.name == "postgresql" else ""
    for table in (
        "conversation_messages",
        "conversations",
        "inbox_messages",
        "inbox_events",
        "inbox_thread_pins",
        "inbox_threads",
        "email_messages",
        "email_threads",
        "email_accounts",
        "feedback_queue_items",
        "message_feedback",
    ):
        if inspector.has_table(table):
            connection.execute(text(f"DROP TABLE {table}{cascade}"))


def _drop_legacy_policy_tables(connection: Connection) -> None:
    """Phase 3: ActionPolicy/whitelist replaced by allowance sliders in tenant settings."""
    inspector = inspect(connection)
    cascade = " CASCADE" if connection.dialect.name == "postgresql" else ""
    for table in ("action_whitelist_entries", "action_policies"):
        if inspector.has_table(table):
            connection.execute(text(f"DROP TABLE {table}{cascade}"))


def _drop_legacy_orchestra_tables(connection: Connection) -> None:
    """Cycle 2: AgentProfile/WorkstreamRun replaced by RuntimeProfile + AgentTask/AgentRun."""
    inspector = inspect(connection)
    cascade = " CASCADE" if connection.dialect.name == "postgresql" else ""
    for table in ("workstream_step_runs", "workstream_runs", "agent_profiles"):
        if inspector.has_table(table):
            connection.execute(text(f"DROP TABLE {table}{cascade}"))


def _block_markdown(content_json: str | None) -> str:
    try:
        content = json.loads(content_json or "{}")
    except json.JSONDecodeError:
        return ""
    if not isinstance(content, dict):
        return ""
    runs = content.get("text")
    if isinstance(runs, list):
        joined = "".join(
            run.get("text", "") for run in runs if isinstance(run, dict)
        ).strip()
        if joined:
            return joined
    for key in ("markdown", "plain"):
        val = content.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return ""


def _migrate_blueprint_to_workspace_docs(connection: Connection) -> None:
    """Phase 4: Blueprint pages/blocks become markdown WorkspaceDocs, then drop the stack.

    Chunks are rebuilt on next doc save; content migration is the durable part.
    """
    inspector = inspect(connection)
    if inspector.has_table("blueprint_pages") and inspector.has_table("workspace_docs"):
        existing_paths = {
            (str(r["tenant_id"]), r["path"])
            for r in _rows(connection, "SELECT tenant_id, path FROM workspace_docs")
        }
        for page in _rows(connection, "SELECT * FROM blueprint_pages"):
            slug = page["slug"] or "page"
            path = f"docs/{slug}.md"
            if (str(page["tenant_id"]), path) in existing_paths:
                continue
            lines = [f"# {page['title']}"]
            if inspector.has_table("blueprint_blocks"):
                for block in _rows(
                    connection,
                    f"SELECT * FROM blueprint_blocks WHERE page_id = '{page['id']}' ORDER BY sort_order",
                ):
                    text_md = _block_markdown(block["content_json"])
                    if not text_md:
                        continue
                    block_type = block["block_type"] or "paragraph"
                    if block_type.startswith("heading"):
                        lines.append(f"## {text_md}")
                    elif block_type in ("bulleted_list_item", "list_item"):
                        lines.append(f"- {text_md}")
                    else:
                        lines.append(text_md)
            connection.execute(
                text(
                    "INSERT INTO workspace_docs "
                    "(id, tenant_id, path, kind, title, content, frontmatter_json,"
                    " is_pinned, sort_order, created_by_type, created_by_id, created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :path, 'doc', :title, :content, '{}',"
                    " 0, :sort_order, 'system', '', :created_at, :created_at)"
                ),
                {
                    "id": str(uuid.uuid4()),
                    "tenant_id": page["tenant_id"],
                    "path": path,
                    "title": page["title"] or slug,
                    "content": "\n\n".join(lines),
                    "sort_order": page.get("sort_order") or 0,
                    "created_at": page["created_at"],
                },
            )

    cascade = " CASCADE" if connection.dialect.name == "postgresql" else ""
    for table in (
        "block_revisions",
        "blueprint_change_requests",
        "blueprint_blocks",
        "blueprint_pages",
        "blueprint_docs",
        "index_chunks",
    ):
        if inspector.has_table(table):
            connection.execute(text(f"DROP TABLE {table}{cascade}"))

    # Scope rename: platform:blueprint:write -> platform:doc:write on agent passports.
    if inspector.has_table("agents"):
        agent_cols = {col["name"] for col in inspector.get_columns("agents")}
        if "permission_scopes_json" in agent_cols:
            connection.execute(
                text(
                    "UPDATE agents SET permission_scopes_json = "
                    "REPLACE(permission_scopes_json, 'platform:blueprint:write', 'platform:doc:write')"
                )
            )


def _migrate_schedules_to_triggers(connection: Connection) -> None:
    """Phase 5: orchestra_tasks / agenda wake events / automation_templates -> triggers."""
    inspector = inspect(connection)
    if not inspector.has_table("triggers"):
        return

    # Boolean literals differ per dialect: Postgres rejects `enabled = 1`.
    true_lit = "true" if connection.dialect.name == "postgresql" else "1"

    if inspector.has_table("orchestra_tasks"):
        existing = {
            (str(r["tenant_id"]), r["name"])
            for r in _rows(connection, "SELECT tenant_id, name FROM triggers")
        }
        for row in _rows(
            connection,
            f"SELECT * FROM orchestra_tasks WHERE enabled = {true_lit} "
            "AND schedule_kind IN ('interval', 'cron')",
        ):
            if (str(row["tenant_id"]), row["name"]) in existing:
                continue
            kind = "cron" if row["schedule_kind"] == "cron" else "interval"
            interval = 0
            if kind == "interval":
                expr = (row["schedule_expr"] or "60").strip().lower()
                try:
                    interval = int(expr.rstrip("d").rstrip("h").rstrip("m") or "60")
                except ValueError:
                    interval = 60
                if expr.endswith("d"):
                    interval *= 1440
                elif expr.endswith("h"):
                    interval *= 60
            connection.execute(
                text(
                    "INSERT INTO triggers "
                    "(id, tenant_id, name, kind, cron_expr, interval_minutes, agent_role,"
                    " instructions, webhook_secret, enabled, next_run_at, last_status,"
                    " created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :name, :kind, :cron_expr, :interval_minutes,"
                    f" 'orchestra', :instructions, '', {true_lit}, :next_run_at, '',"
                    " :created_at, :created_at)"
                ),
                {
                    "id": str(uuid.uuid4()),
                    "tenant_id": row["tenant_id"],
                    "name": row["name"],
                    "kind": kind,
                    "cron_expr": row["schedule_expr"] if kind == "cron" else "",
                    "interval_minutes": interval,
                    "instructions": row["instructions"] or "",
                    "next_run_at": row["next_run_at"],
                    "created_at": row["created_at"],
                },
            )

    if inspector.has_table("agenda_events"):
        existing = {
            (str(r["tenant_id"]), r["name"])
            for r in _rows(connection, "SELECT tenant_id, name FROM triggers")
        }
        for row in _rows(
            connection,
            f"SELECT * FROM agenda_events WHERE kind = 'orchestrator' AND enabled = {true_lit} "
            "AND recurrence_freq != ''",
        ):
            if (str(row["tenant_id"]), row["title"]) in existing:
                continue
            freq = row["recurrence_freq"]
            interval_units = {"hourly": 60, "daily": 1440, "weekly": 10080, "monthly": 43200}
            minutes = interval_units.get(freq, 1440) * max(1, row["recurrence_interval"] or 1)
            connection.execute(
                text(
                    "INSERT INTO triggers "
                    "(id, tenant_id, name, kind, cron_expr, interval_minutes, agent_role,"
                    " instructions, webhook_secret, enabled, next_run_at, last_status,"
                    " created_at, updated_at) "
                    "VALUES (:id, :tenant_id, :name, 'interval', '', :interval_minutes,"
                    f" :agent_role, :instructions, '', {true_lit}, :next_run_at, '',"
                    " :created_at, :created_at)"
                ),
                {
                    "id": str(uuid.uuid4()),
                    "tenant_id": row["tenant_id"],
                    "name": row["title"],
                    "interval_minutes": minutes,
                    "agent_role": row["agent_role"] or "orchestra",
                    "instructions": row["prompt"] or "",
                    "next_run_at": row["next_run_at"],
                    "created_at": row["created_at"],
                },
            )

    cascade = " CASCADE" if connection.dialect.name == "postgresql" else ""
    for table in ("agenda_events", "agenda_calendars", "orchestra_tasks", "automation_templates"):
        if inspector.has_table(table):
            connection.execute(text(f"DROP TABLE {table}{cascade}"))


def _backfill_contacts_from_signals(connection: Connection) -> None:
    """Create Contact rows for external signals that predate contact linking."""
    inspector = inspect(connection)
    if not inspector.has_table("signals") or not inspector.has_table("contacts"):
        return
    signal_cols = {c["name"] for c in inspector.get_columns("signals")}
    if "contact_id" not in signal_cols:
        return

    rows = _rows(
        connection,
        "SELECT DISTINCT tenant_id, channel, contact_email, contact_name FROM signals "
        "WHERE contact_id IS NULL AND contact_email != '' "
        "AND channel NOT IN ('assistant', 'internal')",
    )
    for row in rows:
        existing = list(
            connection.execute(
                text(
                    "SELECT id FROM contacts WHERE tenant_id = :tenant_id "
                    "AND channel = :channel AND address = :address"
                ),
                {
                    "tenant_id": row["tenant_id"],
                    "channel": row["channel"],
                    "address": row["contact_email"],
                },
            ).mappings()
        )
        if existing:
            contact_id = existing[0]["id"]
        else:
            contact_id = str(uuid.uuid4())
            connection.execute(
                text(
                    "INSERT INTO contacts (id, tenant_id, channel, address, display_name,"
                    " status, company, title, phone, notes, metadata_json, created_at) "
                    "VALUES (:id, :tenant_id, :channel, :address, :display_name,"
                    " 'approved', '', '', '', '', '{}', CURRENT_TIMESTAMP)"
                ),
                {
                    "id": contact_id,
                    "tenant_id": row["tenant_id"],
                    "channel": row["channel"],
                    "address": row["contact_email"],
                    "display_name": row["contact_name"] or "",
                },
            )
        connection.execute(
            text(
                "UPDATE signals SET contact_id = :contact_id "
                "WHERE tenant_id = :tenant_id AND channel = :channel "
                "AND contact_email = :address AND contact_id IS NULL"
            ),
            {
                "contact_id": contact_id,
                "tenant_id": row["tenant_id"],
                "channel": row["channel"],
                "address": row["contact_email"],
            },
        )


def _normalize_agent_chat_columns(connection: Connection) -> None:
    """Existing agents predate kind/chat_access: they are company agents."""
    inspector = inspect(connection)
    if not inspector.has_table("agents"):
        return
    agent_cols = {col["name"] for col in inspector.get_columns("agents")}
    if "kind" in agent_cols:
        connection.execute(text("UPDATE agents SET kind = 'company' WHERE kind IS NULL"))
    if "chat_access" in agent_cols:
        connection.execute(
            text("UPDATE agents SET chat_access = 'nobody' WHERE chat_access IS NULL")
        )


def _fix_postgres_uuid_columns(connection: Connection) -> None:
    """Convert VARCHAR columns back to native uuid on Postgres.

    Older column patches added uuid-typed model columns as VARCHAR (the SQLite
    fallback). On Postgres that breaks joins against uuid primary keys with
    "operator does not exist: uuid = character varying" (e.g. the Cockpit
    usage breakdown joining usage_ledger.agent_id to agents.id).
    """
    if connection.dialect.name != "postgresql":
        return
    import app.models  # noqa: F401 — register tables

    inspector = inspect(connection)
    for table_name, table in SQLModel.metadata.tables.items():
        if not inspector.has_table(table_name):
            continue
        db_cols = {col["name"]: col for col in inspector.get_columns(table_name)}
        for col in table.columns:
            db_col = db_cols.get(col.name)
            if db_col is None or not _is_uuid_type(col.type):
                continue
            db_type_name = type(db_col["type"]).__name__.lower()
            if "char" not in db_type_name and "string" not in db_type_name and "text" not in db_type_name:
                continue
            # Savepoint per column: rows with malformed non-uuid data must not
            # abort startup or the surrounding repairs transaction.
            try:
                with connection.begin_nested():
                    connection.execute(
                        text(
                            f"ALTER TABLE {table_name} ALTER COLUMN {col.name} "
                            f"TYPE uuid USING NULLIF({col.name}, '')::uuid"
                        )
                    )
            except DBAPIError:
                logger.warning(
                    "Could not convert %s.%s to uuid (malformed data?); leaving as-is",
                    table_name,
                    col.name,
                )


def _relax_oauth_states_tenant(connection: Connection) -> None:
    """SSO login flows create OAuthState rows before a tenant exists, so
    tenant_id must be nullable. oauth_states is ephemeral (15-minute CSRF
    states), so SQLite simply rebuilds the table."""
    inspector = inspect(connection)
    if not inspector.has_table("oauth_states"):
        return
    tenant_col = next(
        (c for c in inspector.get_columns("oauth_states") if c["name"] == "tenant_id"), None
    )
    if tenant_col is None or tenant_col.get("nullable", True):
        return
    if connection.dialect.name == "postgresql":
        connection.execute(text("ALTER TABLE oauth_states ALTER COLUMN tenant_id DROP NOT NULL"))
    else:
        connection.execute(text("DROP TABLE oauth_states"))
        SQLModel.metadata.tables["oauth_states"].create(connection)


def _close_stale_agent_runs(connection: Connection) -> None:
    """Runs stuck on 'running' for over 6 hours can no longer be alive (arq
    tasks and request handlers finish in minutes): close them so agenda,
    cockpit and workforce status reads stay truthful."""
    inspector = inspect(connection)
    if not inspector.has_table("agent_runs"):
        return
    cutoff = "now() - interval '6 hours'" if connection.dialect.name == "postgresql" else "datetime('now', '-6 hours')"
    connection.execute(
        text(
            "UPDATE agent_runs SET status='completed', "
            "completed_at=COALESCE(completed_at, started_at) "
            f"WHERE status='running' AND started_at < {cutoff}"
        )
    )


def _ensure_search_indexes(connection: Connection) -> None:
    """Postgres-only full-text GIN index over message subject + body.

    The expression must match the predicate built in
    `signal_threads.list_threads` exactly, otherwise the planner will not use
    the index. SQLite (tests) keeps the ILIKE fallback and needs no index.
    """
    if connection.dialect.name != "postgresql":
        return
    inspector = inspect(connection)
    if not inspector.has_table("signal_messages"):
        return
    connection.execute(
        text(
            """
            CREATE INDEX IF NOT EXISTS ix_signal_messages_fts
            ON signal_messages USING gin (
                to_tsvector('simple', coalesce(subject, '') || ' ' || coalesce(body_text, ''))
            )
            """
        )
    )


def apply_data_repairs(connection: Connection) -> None:
    """Idempotent data fixes that ALTER cannot express (legacy role cleanup)."""
    _fix_postgres_uuid_columns(connection)
    _ensure_search_indexes(connection)
    _close_stale_agent_runs(connection)
    _relax_oauth_states_tenant(connection)
    _migrate_legacy_threads_to_signals(connection)
    _drop_legacy_policy_tables(connection)
    _drop_legacy_orchestra_tables(connection)
    _migrate_blueprint_to_workspace_docs(connection)
    _migrate_schedules_to_triggers(connection)
    _backfill_contacts_from_signals(connection)
    _normalize_agent_chat_columns(connection)
    inspector = inspect(connection)
    if not inspector.has_table("agents"):
        return
    agent_cols = {col["name"] for col in inspector.get_columns("agents")}

    # Legacy "po" role is now the canonical "orchestrator" role.
    connection.execute(text("UPDATE agents SET role='orchestrator' WHERE role='po'"))
    if "slug" in agent_cols:
        connection.execute(
            text("UPDATE agents SET slug='orchestrator' WHERE slug IN ('po', 'manager')")
        )

    # Remove orphan tenant-level orchestrators (no project link, no runs) in
    # tenants that already have a project-linked orchestrator.
    if inspector.has_table("projects") and inspector.has_table("agent_runs"):
        connection.execute(
            text(
                """
                DELETE FROM agents
                WHERE role = 'orchestrator'
                  AND id NOT IN (
                    SELECT po_agent_id FROM projects WHERE po_agent_id IS NOT NULL
                  )
                  AND tenant_id IN (
                    SELECT tenant_id FROM projects WHERE po_agent_id IS NOT NULL
                  )
                  AND id NOT IN (
                    SELECT agent_id FROM agent_runs WHERE agent_id IS NOT NULL
                  )
                """
            )
        )
