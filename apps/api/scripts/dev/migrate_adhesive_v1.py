"""One-shot data migration for the whole-platform schema consolidation.

Moves the cheap rows into the new canonical tables and drops the legacy ones:

- project_queue_items      -> agent_tasks (unified Task ledger)
- queue_item_doc_links     -> task_doc_links
- Tenant.settings_json.modules -> module_installs
- tenant_secrets           -> provider_connections (BYOK keys)
- inbox_settings           -> Tenant.settings_json.inbox
- runtime_profiles         -> dropped (Agent is the single passport)

Idempotent: skips tables that no longer exist. SQLite dev databases can also
simply be deleted and recreated; this script exists for databases with data
worth keeping (staging / production Postgres).

Run: python scripts/dev/migrate_adhesive_v1.py
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from sqlalchemy import text  # noqa: E402

from app.db.session import engine, init_db  # noqa: E402

# Old queue statuses -> unified task statuses.
STATUS_MAP = {
    "accepted": "queued",
    "in_progress": "running",
    "done": "completed",
}


async def _table_exists(conn, name: str) -> bool:
    dialect = conn.engine.dialect.name
    if dialect == "sqlite":
        row = await conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name=:n"),
            {"n": name},
        )
    else:
        row = await conn.execute(
            text("SELECT table_name FROM information_schema.tables WHERE table_name=:n"),
            {"n": name},
        )
    return row.first() is not None


async def _columns(conn, table: str) -> set[str]:
    dialect = conn.engine.dialect.name
    if dialect == "sqlite":
        rows = await conn.execute(text(f"PRAGMA table_info({table})"))
        return {r[1] for r in rows.fetchall()}
    rows = await conn.execute(
        text("SELECT column_name FROM information_schema.columns WHERE table_name=:t"),
        {"t": table},
    )
    return {r[0] for r in rows.fetchall()}


async def migrate_queue_items(conn) -> int:
    if not await _table_exists(conn, "project_queue_items"):
        return 0
    cols = await _columns(conn, "project_queue_items")

    def col(name: str, default: str = "NULL") -> str:
        return name if name in cols else default

    empty = "''"
    select_cols = ", ".join(
        [
            "id",
            "tenant_id",
            "project_id",
            col("kind", "'task'"),
            "title",
            col("body", empty),
            col("status", "'proposed'"),
            col("priority", "'normal'"),
            col("origin_type", "'manual'"),
            col("duplicate_of_id"),
            col("assigned_agent_id"),
            col("impact_summary", empty),
            col("analyzed_at"),
            col("metadata_json", "'{}'"),
            col("signal_id"),
            col("message_id"),
            col("created_by_type", "'user'"),
            col("created_by_id", empty),
            "created_at",
            "updated_at",
        ]
    )
    rows = (
        await conn.execute(
            text(f"SELECT {select_cols} FROM project_queue_items")
        )
    ).fetchall()
    moved = 0
    for r in rows:
        status = STATUS_MAP.get(str(r[6]), str(r[6]))
        exists = await conn.execute(
            text("SELECT 1 FROM agent_tasks WHERE id = :id"), {"id": r[0]}
        )
        if exists.first():
            continue
        await conn.execute(
            text(
                "INSERT INTO agent_tasks (id, tenant_id, project_id, kind, title, "
                "description, status, priority, origin, duplicate_of_id, "
                "assignee_kind, assignee_agent_id, impact_summary, analyzed_at, "
                "metadata_json, signal_id, message_id, created_by_type, created_by_id, "
                "context_json, success_criteria_json, trigger_type, pause_reason, "
                "created_at, updated_at) "
                "VALUES (:id, :tenant_id, :project_id, :kind, :title, :description, "
                ":status, :priority, :origin, :duplicate_of_id, 'agent', "
                ":assignee_agent_id, :impact_summary, :analyzed_at, :metadata_json, "
                ":signal_id, :message_id, :created_by_type, :created_by_id, "
                "'{}', '{}', 'manual', NULL, :created_at, :updated_at)"
            ),
            {
                "id": r[0],
                "tenant_id": r[1],
                "project_id": r[2],
                "kind": r[3] or "task",
                "title": r[4],
                "description": r[5] or "",
                "status": status,
                "priority": r[7] or "normal",
                "origin": r[8] or "manual",
                "duplicate_of_id": r[9],
                "assignee_agent_id": r[10],
                "impact_summary": r[11] or "",
                "analyzed_at": r[12],
                "metadata_json": r[13] or "{}",
                "signal_id": r[14],
                "message_id": r[15],
                "created_by_type": r[16] or "user",
                "created_by_id": r[17] or "",
                "created_at": r[18],
                "updated_at": r[19],
            },
        )
        moved += 1
    return moved


async def migrate_doc_links(conn) -> int:
    if not await _table_exists(conn, "queue_item_doc_links"):
        return 0
    cols = await _columns(conn, "queue_item_doc_links")
    item_col = "queue_item_id" if "queue_item_id" in cols else "task_id"
    rows = (
        await conn.execute(
            text(
                f"SELECT id, tenant_id, {item_col}, section_id, created_at "
                "FROM queue_item_doc_links"
            )
        )
    ).fetchall()
    moved = 0
    for r in rows:
        exists = await conn.execute(
            text("SELECT 1 FROM task_doc_links WHERE id = :id"), {"id": r[0]}
        )
        if exists.first():
            continue
        await conn.execute(
            text(
                "INSERT INTO task_doc_links (id, tenant_id, task_id, section_id, created_at) "
                "VALUES (:id, :tenant_id, :task_id, :section_id, :created_at)"
            ),
            {"id": r[0], "tenant_id": r[1], "task_id": r[2], "section_id": r[3], "created_at": r[4]},
        )
        moved += 1
    return moved


async def migrate_module_prefs(conn) -> int:
    """Tenant.settings_json.modules -> module_installs rows."""
    import uuid
    from datetime import datetime

    rows = (await conn.execute(text("SELECT id, settings_json FROM tenants"))).fetchall()
    moved = 0
    for tenant_id, settings_raw in rows:
        try:
            settings = json.loads(settings_raw or "{}")
        except json.JSONDecodeError:
            continue
        modules = settings.get("modules")
        if not isinstance(modules, dict):
            continue
        for slug, row in modules.items():
            data = row if isinstance(row, dict) else {}
            if isinstance(row, bool):
                state = "installed" if row else "not_installed"
            else:
                state = str(data.get("install_state") or "").strip().lower()
                if state not in ("not_installed", "setup", "installed"):
                    state = "installed" if data.get("enabled") else "not_installed"
            exists = await conn.execute(
                text(
                    "SELECT 1 FROM module_installs WHERE tenant_id = :t AND module_slug = :s"
                ),
                {"t": tenant_id, "s": str(slug)},
            )
            if exists.first():
                continue
            company_map = data.get("default_company_by_connection")
            user_access = data.get("user_access")
            await conn.execute(
                text(
                    "INSERT INTO module_installs (id, tenant_id, module_slug, "
                    "install_state, writes_enabled, default_connection_id, "
                    "default_company_json, user_access_json, created_at, updated_at) "
                    "VALUES (:id, :t, :s, :state, :writes, :conn_id, :companies, "
                    ":access, :now, :now)"
                ),
                {
                    "id": str(uuid.uuid4()),
                    "t": tenant_id,
                    "s": str(slug),
                    "state": state,
                    "writes": bool(data.get("writes_enabled")),
                    "conn_id": str(data.get("default_connection_id") or "") or None,
                    "companies": json.dumps(company_map if isinstance(company_map, dict) else {}),
                    "access": json.dumps(user_access if isinstance(user_access, dict) else {}),
                    "now": datetime.utcnow(),
                },
            )
            moved += 1
        # The JSON blob is no longer read; strip it so it cannot drift.
        settings.pop("modules", None)
        await conn.execute(
            text("UPDATE tenants SET settings_json = :s WHERE id = :id"),
            {"s": json.dumps(settings), "id": tenant_id},
        )
    return moved


async def migrate_tenant_secrets(conn) -> int:
    """tenant_secrets -> provider_connections (same Fernet ciphertext)."""
    import uuid
    from datetime import datetime

    if not await _table_exists(conn, "tenant_secrets"):
        return 0
    labels = {"anthropic": "Anthropic", "openai": "OpenAI"}
    rows = (
        await conn.execute(
            text("SELECT tenant_id, provider, encrypted_value, last4 FROM tenant_secrets")
        )
    ).fetchall()
    moved = 0
    for tenant_id, provider, encrypted_value, last4 in rows:
        if not encrypted_value:
            continue
        exists = await conn.execute(
            text(
                "SELECT 1 FROM provider_connections "
                "WHERE tenant_id = :t AND provider_type = :p"
            ),
            {"t": tenant_id, "p": provider},
        )
        if exists.first():
            continue
        await conn.execute(
            text(
                "INSERT INTO provider_connections (id, tenant_id, provider_type, "
                "label, base_url, encrypted_value, last4, enabled, created_at, updated_at) "
                "VALUES (:id, :t, :p, :label, '', :val, :last4, :enabled, :now, :now)"
            ),
            {
                "id": str(uuid.uuid4()),
                "t": tenant_id,
                "p": provider,
                "label": labels.get(provider, provider),
                "val": encrypted_value,
                "last4": last4 or "",
                "enabled": True,
                "now": datetime.utcnow(),
            },
        )
        moved += 1
    return moved


async def migrate_inbox_settings(conn) -> int:
    """inbox_settings rows -> Tenant.settings_json.inbox."""
    if not await _table_exists(conn, "inbox_settings"):
        return 0
    rows = (
        await conn.execute(
            text("SELECT tenant_id, autonomous_reply, certainty_threshold FROM inbox_settings")
        )
    ).fetchall()
    moved = 0
    for tenant_id, autonomous_reply, threshold in rows:
        raw = (
            await conn.execute(
                text("SELECT settings_json FROM tenants WHERE id = :id"), {"id": tenant_id}
            )
        ).scalar()
        try:
            settings = json.loads(raw or "{}")
        except json.JSONDecodeError:
            settings = {}
        if "inbox" in settings:
            continue
        settings["inbox"] = {
            "autonomous_reply": bool(autonomous_reply),
            "certainty_threshold": int(threshold or 7),
        }
        await conn.execute(
            text("UPDATE tenants SET settings_json = :s WHERE id = :id"),
            {"s": json.dumps(settings), "id": tenant_id},
        )
        moved += 1
    return moved


LEGACY_TABLES = (
    "queue_item_doc_links",
    "project_queue_items",
    "runtime_profiles",
    "tenant_secrets",
    "inbox_settings",
)


async def drop_legacy_tables(conn) -> list[str]:
    dropped: list[str] = []
    for table in LEGACY_TABLES:
        if await _table_exists(conn, table):
            await conn.execute(text(f"DROP TABLE {table}"))
            dropped.append(table)
    return dropped


async def main() -> None:
    await init_db()  # creates the new tables before rows move in
    async with engine.begin() as conn:
        tasks = await migrate_queue_items(conn)
        links = await migrate_doc_links(conn)
        modules = await migrate_module_prefs(conn)
        secrets = await migrate_tenant_secrets(conn)
        inbox = await migrate_inbox_settings(conn)
        dropped = await drop_legacy_tables(conn)
    print(f"queue items -> tasks: {tasks}")
    print(f"doc links: {links}")
    print(f"module installs: {modules}")
    print(f"provider keys: {secrets}")
    print(f"inbox settings: {inbox}")
    print(f"dropped tables: {', '.join(dropped) or 'none'}")


if __name__ == "__main__":
    asyncio.run(main())
