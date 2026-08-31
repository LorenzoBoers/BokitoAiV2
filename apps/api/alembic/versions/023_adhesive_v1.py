"""Whole-platform adhesive schema consolidation.

Revision ID: 023_adhesive_v1
Revises: 022_module_agent_scope

- New tables: module_installs, agent_scopes, task_doc_links
- Expand agent_tasks into the unified Task ledger (queue + human assignees)
- Data move: project_queue_items -> agent_tasks, queue_item_doc_links ->
  task_doc_links, Tenant.settings_json.modules -> module_installs,
  tenant_secrets -> provider_connections, inbox_settings -> settings_json.inbox
- Drop legacy tables: project_queue_items, queue_item_doc_links,
  runtime_profiles, tenant_secrets, inbox_settings
- Drop agent_tasks.default_runtime_profile_id (passport lives on Agent)
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision = "023_adhesive_v1"
down_revision = "022_module_agent_scope"
branch_labels = None
depends_on = None

STATUS_MAP = {
    "accepted": "queued",
    "in_progress": "running",
    "done": "completed",
}


def _cols(inspector, table: str) -> set[str]:
    if not inspector.has_table(table):
        return set()
    return {c["name"] for c in inspector.get_columns(table)}


def _add_column_if_missing(inspector, table: str, column: sa.Column) -> None:
    if column.name not in _cols(inspector, table):
        op.add_column(table, column)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # --- New tables ---------------------------------------------------------
    if not inspector.has_table("module_installs"):
        op.create_table(
            "module_installs",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
            sa.Column("module_slug", sa.String(length=64), nullable=False),
            sa.Column("install_state", sa.String(length=16), nullable=False, server_default="setup"),
            sa.Column("writes_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("default_connection_id", sa.String(length=64), nullable=True),
            sa.Column("default_company_json", sa.String(), nullable=False, server_default="{}"),
            sa.Column("user_access_json", sa.String(), nullable=False, server_default="{}"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("tenant_id", "module_slug", name="uq_module_install"),
        )
        op.create_index("ix_module_installs_tenant_id", "module_installs", ["tenant_id"])
        op.create_index("ix_module_installs_module_slug", "module_installs", ["module_slug"])

    if not inspector.has_table("agent_scopes"):
        op.create_table(
            "agent_scopes",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
            sa.Column("agent_id", sa.Uuid(), sa.ForeignKey("agents.id"), nullable=False),
            sa.Column("resource_kind", sa.String(length=32), nullable=False),
            sa.Column("resource_id", sa.String(length=128), nullable=False),
            sa.Column("can_write", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint(
                "tenant_id",
                "agent_id",
                "resource_kind",
                "resource_id",
                name="uq_agent_scope",
            ),
        )
        op.create_index("ix_agent_scopes_tenant_id", "agent_scopes", ["tenant_id"])
        op.create_index("ix_agent_scopes_agent_id", "agent_scopes", ["agent_id"])
        op.create_index("ix_agent_scopes_resource_kind", "agent_scopes", ["resource_kind"])

    if not inspector.has_table("task_doc_links"):
        op.create_table(
            "task_doc_links",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
            sa.Column("task_id", sa.Uuid(), sa.ForeignKey("agent_tasks.id"), nullable=False),
            sa.Column(
                "section_id",
                sa.Uuid(),
                sa.ForeignKey("project_doc_sections.id"),
                nullable=False,
            ),
            sa.Column("relation", sa.String(), nullable=False, server_default="touches"),
            sa.Column("created_by_type", sa.String(), nullable=False, server_default="agent"),
            sa.Column("created_by_id", sa.String(), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("task_id", "section_id", name="uq_task_section"),
        )
        op.create_index("ix_task_doc_links_tenant_id", "task_doc_links", ["tenant_id"])
        op.create_index("ix_task_doc_links_task_id", "task_doc_links", ["task_id"])
        op.create_index("ix_task_doc_links_section_id", "task_doc_links", ["section_id"])

    # Refresh inspector after creates.
    inspector = sa.inspect(bind)

    # --- Expand agent_tasks -------------------------------------------------
    if inspector.has_table("agent_tasks"):
        _add_column_if_missing(
            inspector,
            "agent_tasks",
            sa.Column("kind", sa.String(), nullable=False, server_default="job"),
        )
        _add_column_if_missing(
            inspector,
            "agent_tasks",
            sa.Column("priority", sa.String(), nullable=False, server_default="normal"),
        )
        _add_column_if_missing(
            inspector,
            "agent_tasks",
            sa.Column("origin", sa.String(), nullable=False, server_default="manual"),
        )
        _add_column_if_missing(
            inspector,
            "agent_tasks",
            sa.Column("duplicate_of_id", sa.Uuid(), nullable=True),
        )
        _add_column_if_missing(
            inspector,
            "agent_tasks",
            sa.Column("created_by_type", sa.String(), nullable=False, server_default="user"),
        )
        _add_column_if_missing(
            inspector,
            "agent_tasks",
            sa.Column("created_by_id", sa.String(), nullable=False, server_default=""),
        )
        _add_column_if_missing(
            inspector,
            "agent_tasks",
            sa.Column("assignee_kind", sa.String(), nullable=False, server_default="agent"),
        )
        _add_column_if_missing(
            inspector,
            "agent_tasks",
            sa.Column("assignee_agent_id", sa.Uuid(), nullable=True),
        )
        _add_column_if_missing(
            inspector,
            "agent_tasks",
            sa.Column("assignee_user_id", sa.Uuid(), nullable=True),
        )
        _add_column_if_missing(
            inspector,
            "agent_tasks",
            sa.Column("impact_summary", sa.String(), nullable=False, server_default=""),
        )
        _add_column_if_missing(
            inspector,
            "agent_tasks",
            sa.Column("analyzed_at", sa.DateTime(), nullable=True),
        )
        _add_column_if_missing(
            inspector,
            "agent_tasks",
            sa.Column("metadata_json", sa.String(), nullable=False, server_default="{}"),
        )
        _add_column_if_missing(
            inspector,
            "agent_tasks",
            sa.Column("message_id", sa.Uuid(), nullable=True),
        )
        _add_column_if_missing(
            inspector,
            "agent_tasks",
            sa.Column("scheduled_for", sa.DateTime(), nullable=True),
        )
        _add_column_if_missing(
            inspector,
            "agent_tasks",
            sa.Column("updated_at", sa.DateTime(), nullable=True),
        )
        bind.execute(
            sa.text(
                "UPDATE agent_tasks SET updated_at = COALESCE(updated_at, created_at, NOW()) "
                "WHERE updated_at IS NULL"
            )
        )
        # Refresh and tighten nullability + indexes.
        inspector = sa.inspect(bind)
        if "updated_at" in _cols(inspector, "agent_tasks"):
            op.alter_column("agent_tasks", "updated_at", nullable=False)
        existing_indexes = {ix["name"] for ix in inspector.get_indexes("agent_tasks")}
        for name, cols in (
            ("ix_agent_tasks_kind", ["kind"]),
            ("ix_agent_tasks_priority", ["priority"]),
            ("ix_agent_tasks_assignee_agent_id", ["assignee_agent_id"]),
        ):
            if name not in existing_indexes:
                op.create_index(name, "agent_tasks", cols)

    # --- Data migrations ----------------------------------------------------
    _migrate_queue_items(bind)
    _migrate_doc_links(bind)
    _migrate_module_prefs(bind)
    _migrate_tenant_secrets(bind)
    _migrate_inbox_settings(bind)

    # --- Drop legacy FK/column on agent_tasks -------------------------------
    inspector = sa.inspect(bind)
    if "default_runtime_profile_id" in _cols(inspector, "agent_tasks"):
        # Drop FK first when present.
        for fk in inspector.get_foreign_keys("agent_tasks"):
            if "default_runtime_profile_id" in (fk.get("constrained_columns") or []):
                if fk.get("name"):
                    op.drop_constraint(fk["name"], "agent_tasks", type_="foreignkey")
        op.drop_column("agent_tasks", "default_runtime_profile_id")

    # --- Drop legacy tables (children first) --------------------------------
    for table in (
        "queue_item_doc_links",
        "project_queue_items",
        "runtime_profiles",
        "tenant_secrets",
        "inbox_settings",
    ):
        inspector = sa.inspect(bind)
        if inspector.has_table(table):
            op.drop_table(table)


def _migrate_queue_items(bind) -> None:
    inspector = sa.inspect(bind)
    if not inspector.has_table("project_queue_items"):
        return
    cols = _cols(inspector, "project_queue_items")
    rows = bind.execute(sa.text("SELECT * FROM project_queue_items")).mappings().all()
    for r in rows:
        exists = bind.execute(
            sa.text("SELECT 1 FROM agent_tasks WHERE id = :id"), {"id": r["id"]}
        ).first()
        if exists:
            continue
        status = STATUS_MAP.get(str(r.get("status") or ""), str(r.get("status") or "proposed"))
        bind.execute(
            sa.text(
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
                "id": r["id"],
                "tenant_id": r["tenant_id"],
                "project_id": r["project_id"],
                "kind": r.get("kind") or "task",
                "title": r["title"],
                "description": (r.get("body") if "body" in cols else "") or "",
                "status": status,
                "priority": r.get("priority") or "normal",
                "origin": (r.get("origin_type") if "origin_type" in cols else "manual") or "manual",
                "duplicate_of_id": r.get("duplicate_of_id"),
                "assignee_agent_id": r.get("assigned_agent_id"),
                "impact_summary": r.get("impact_summary") or "",
                "analyzed_at": r.get("analyzed_at"),
                "metadata_json": r.get("metadata_json") or "{}",
                "signal_id": r.get("signal_id"),
                "message_id": r.get("message_id"),
                "created_by_type": r.get("created_by_type") or "user",
                "created_by_id": r.get("created_by_id") or "",
                "created_at": r.get("created_at") or datetime.utcnow(),
                "updated_at": r.get("updated_at") or r.get("created_at") or datetime.utcnow(),
            },
        )


def _migrate_doc_links(bind) -> None:
    inspector = sa.inspect(bind)
    if not inspector.has_table("queue_item_doc_links"):
        return
    cols = _cols(inspector, "queue_item_doc_links")
    item_col = "queue_item_id" if "queue_item_id" in cols else "task_id"
    rows = bind.execute(
        sa.text(
            f"SELECT id, tenant_id, {item_col} AS task_id, section_id, "
            "COALESCE(relation, 'touches') AS relation, "
            "COALESCE(created_by_type, 'agent') AS created_by_type, "
            "COALESCE(created_by_id, '') AS created_by_id, created_at "
            "FROM queue_item_doc_links"
        )
    ).mappings().all()
    for r in rows:
        exists = bind.execute(
            sa.text("SELECT 1 FROM task_doc_links WHERE id = :id"), {"id": r["id"]}
        ).first()
        if exists:
            continue
        # Skip orphaned links whose queue item never made it into agent_tasks.
        task_exists = bind.execute(
            sa.text("SELECT 1 FROM agent_tasks WHERE id = :id"), {"id": r["task_id"]}
        ).first()
        if not task_exists:
            continue
        bind.execute(
            sa.text(
                "INSERT INTO task_doc_links "
                "(id, tenant_id, task_id, section_id, relation, created_by_type, "
                "created_by_id, created_at) "
                "VALUES (:id, :tenant_id, :task_id, :section_id, :relation, "
                ":created_by_type, :created_by_id, :created_at)"
            ),
            dict(r),
        )


def _migrate_module_prefs(bind) -> None:
    rows = bind.execute(sa.text("SELECT id, settings_json FROM tenants")).fetchall()
    now = datetime.utcnow()
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
            exists = bind.execute(
                sa.text(
                    "SELECT 1 FROM module_installs "
                    "WHERE tenant_id = :t AND module_slug = :s"
                ),
                {"t": tenant_id, "s": str(slug)},
            ).first()
            if exists:
                continue
            company_map = data.get("default_company_by_connection")
            user_access = data.get("user_access")
            bind.execute(
                sa.text(
                    "INSERT INTO module_installs (id, tenant_id, module_slug, "
                    "install_state, writes_enabled, default_connection_id, "
                    "default_company_json, user_access_json, created_at, updated_at) "
                    "VALUES (:id, :t, :s, :state, :writes, :conn_id, :companies, "
                    ":access, :now, :now)"
                ),
                {
                    "id": uuid.uuid4(),
                    "t": tenant_id,
                    "s": str(slug),
                    "state": state,
                    "writes": bool(data.get("writes_enabled")),
                    "conn_id": str(data.get("default_connection_id") or "") or None,
                    "companies": json.dumps(
                        company_map if isinstance(company_map, dict) else {}
                    ),
                    "access": json.dumps(
                        user_access if isinstance(user_access, dict) else {}
                    ),
                    "now": now,
                },
            )
        settings.pop("modules", None)
        bind.execute(
            sa.text("UPDATE tenants SET settings_json = :s WHERE id = :id"),
            {"s": json.dumps(settings), "id": tenant_id},
        )


def _migrate_tenant_secrets(bind) -> None:
    inspector = sa.inspect(bind)
    if not inspector.has_table("tenant_secrets"):
        return
    labels = {"anthropic": "Anthropic", "openai": "OpenAI"}
    rows = bind.execute(
        sa.text(
            "SELECT tenant_id, provider, encrypted_value, last4 FROM tenant_secrets"
        )
    ).fetchall()
    now = datetime.utcnow()
    for tenant_id, provider, encrypted_value, last4 in rows:
        if not encrypted_value:
            continue
        exists = bind.execute(
            sa.text(
                "SELECT 1 FROM provider_connections "
                "WHERE tenant_id = :t AND provider_type = :p"
            ),
            {"t": tenant_id, "p": provider},
        ).first()
        if exists:
            continue
        bind.execute(
            sa.text(
                "INSERT INTO provider_connections (id, tenant_id, provider_type, "
                "label, base_url, encrypted_value, last4, enabled, created_at, updated_at) "
                "VALUES (:id, :t, :p, :label, '', :val, :last4, :enabled, :now, :now)"
            ),
            {
                "id": uuid.uuid4(),
                "t": tenant_id,
                "p": provider,
                "label": labels.get(provider, provider),
                "val": encrypted_value,
                "last4": last4 or "",
                "enabled": True,
                "now": now,
            },
        )


def _migrate_inbox_settings(bind) -> None:
    inspector = sa.inspect(bind)
    if not inspector.has_table("inbox_settings"):
        return
    rows = bind.execute(
        sa.text(
            "SELECT tenant_id, autonomous_reply, certainty_threshold FROM inbox_settings"
        )
    ).fetchall()
    for tenant_id, autonomous_reply, threshold in rows:
        raw = bind.execute(
            sa.text("SELECT settings_json FROM tenants WHERE id = :id"),
            {"id": tenant_id},
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
        bind.execute(
            sa.text("UPDATE tenants SET settings_json = :s WHERE id = :id"),
            {"s": json.dumps(settings), "id": tenant_id},
        )


def downgrade() -> None:
    # Forward-only consolidation; recreate empty legacy shells if needed.
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("agent_scopes"):
        op.drop_table("agent_scopes")
    if inspector.has_table("module_installs"):
        op.drop_table("module_installs")
    if inspector.has_table("task_doc_links"):
        op.drop_table("task_doc_links")
