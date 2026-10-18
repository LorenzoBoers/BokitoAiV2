"""Promote buried setup links into tables and foreign keys.

Revision ID: 110_setup_links
Revises: 109_departments

Channel routing, access grants, and flow stage owners leave JSON. New binds:
a flow to a channel or a connection, a folder to a department, a webhook to a
flow, and an agent scope of kind connection. The JSON columns stay so older
readers keep working.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision = "110_setup_links"
down_revision = "109_departments"
branch_labels = None
depends_on = None


def _uuid(value):
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError):
        return None


def upgrade() -> None:
    op.add_column(
        "channel_accounts",
        sa.Column("routing_department_id", sa.Uuid(), nullable=True),
    )
    op.add_column("channel_accounts", sa.Column("routing_user_id", sa.Uuid(), nullable=True))
    op.create_index("ix_channel_accounts_routing_department_id", "channel_accounts", ["routing_department_id"])
    op.create_index("ix_channel_accounts_routing_user_id", "channel_accounts", ["routing_user_id"])
    op.create_foreign_key(
        "fk_channel_accounts_routing_department",
        "channel_accounts",
        "departments",
        ["routing_department_id"],
        ["id"],
    )
    op.create_foreign_key(
        "fk_channel_accounts_routing_user",
        "channel_accounts",
        "users",
        ["routing_user_id"],
        ["id"],
    )
    op.add_column("projects", sa.Column("department_id", sa.Uuid(), nullable=True))
    op.create_index("ix_projects_department_id", "projects", ["department_id"])
    op.create_foreign_key("fk_projects_department", "projects", "departments", ["department_id"], ["id"])
    op.add_column("webhook_endpoints", sa.Column("workstream_id", sa.Uuid(), nullable=True))
    op.create_index("ix_webhook_endpoints_workstream_id", "webhook_endpoints", ["workstream_id"])
    op.create_foreign_key(
        "fk_webhook_endpoints_workstream",
        "webhook_endpoints",
        "workstreams",
        ["workstream_id"],
        ["id"],
    )
    op.add_column("agent_scopes", sa.Column("connection_id", sa.Uuid(), nullable=True))
    op.create_index("ix_agent_scopes_connection_id", "agent_scopes", ["connection_id"])
    op.create_foreign_key(
        "fk_agent_scopes_connection",
        "agent_scopes",
        "integration_connections",
        ["connection_id"],
        ["id"],
    )

    op.create_table(
        "resource_grants",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("resource_kind", sa.String(32), nullable=False),
        sa.Column("channel_account_id", sa.Uuid(), sa.ForeignKey("channel_accounts.id")),
        sa.Column("calendar_id", sa.Uuid(), sa.ForeignKey("tenant_calendars.id")),
        sa.Column("connection_id", sa.Uuid(), sa.ForeignKey("integration_connections.id")),
        sa.Column("module_install_id", sa.Uuid(), sa.ForeignKey("module_installs.id")),
        sa.Column("principal_kind", sa.String(32), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id")),
        sa.Column("agent_id", sa.Uuid(), sa.ForeignKey("agents.id")),
        sa.Column("department_id", sa.Uuid(), sa.ForeignKey("departments.id")),
        sa.Column("level", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_resource_grants_tenant_id", "resource_grants", ["tenant_id"])
    op.create_index("ix_resource_grants_resource_kind", "resource_grants", ["resource_kind"])
    op.create_index("ix_resource_grants_channel_account_id", "resource_grants", ["channel_account_id"])
    op.create_index("ix_resource_grants_calendar_id", "resource_grants", ["calendar_id"])
    op.create_index("ix_resource_grants_connection_id", "resource_grants", ["connection_id"])
    op.create_index("ix_resource_grants_module_install_id", "resource_grants", ["module_install_id"])
    op.create_index("ix_resource_grants_department_id", "resource_grants", ["department_id"])

    op.create_table(
        "workstream_stages",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("workstream_id", sa.Uuid(), sa.ForeignKey("workstreams.id"), nullable=False),
        sa.Column("key", sa.String(64), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("checkup_minutes", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_workstream_stages_tenant_id", "workstream_stages", ["tenant_id"])
    op.create_index("ix_workstream_stages_workstream_id", "workstream_stages", ["workstream_id"])
    op.create_table(
        "workstream_stage_owners",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("stage_id", sa.Uuid(), sa.ForeignKey("workstream_stages.id"), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id")),
        sa.Column("agent_id", sa.Uuid(), sa.ForeignKey("agents.id")),
        sa.Column("department_id", sa.Uuid(), sa.ForeignKey("departments.id")),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_workstream_stage_owners_stage_id", "workstream_stage_owners", ["stage_id"])
    op.create_index("ix_workstream_stage_owners_tenant_id", "workstream_stage_owners", ["tenant_id"])
    op.create_table(
        "workstream_connections",
        sa.Column("workstream_id", sa.Uuid(), sa.ForeignKey("workstreams.id"), primary_key=True),
        sa.Column("connection_id", sa.Uuid(), sa.ForeignKey("integration_connections.id"), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("purpose", sa.String(16), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_workstream_connections_tenant_id", "workstream_connections", ["tenant_id"])
    op.create_table(
        "workstream_channels",
        sa.Column("workstream_id", sa.Uuid(), sa.ForeignKey("workstreams.id"), primary_key=True),
        sa.Column("channel_account_id", sa.Uuid(), sa.ForeignKey("channel_accounts.id"), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_workstream_channels_tenant_id", "workstream_channels", ["tenant_id"])
    _backfill()


def _backfill() -> None:
    bind = op.get_bind()
    now = datetime.utcnow()
    for row in bind.execute(sa.text("SELECT id, settings_json FROM channel_accounts")).mappings():
        try:
            settings = json.loads(row["settings_json"] or "{}")
        except json.JSONDecodeError:
            settings = {}
        routing = settings.get("routing") if isinstance(settings.get("routing"), dict) else {}
        user_id = _uuid(routing.get("user_id"))
        department_id = None if user_id else _uuid(routing.get("department_id") or routing.get("team_id"))
        if user_id or department_id:
            bind.execute(
                sa.text(
                    "UPDATE channel_accounts SET routing_user_id = :user_id, "
                    "routing_department_id = :department_id WHERE id = :id"
                ),
                {"id": row["id"], "user_id": user_id, "department_id": department_id},
            )
        access = settings.get("access") if isinstance(settings.get("access"), list) else []
        _grant_rows(bind, row, "channel", access, channel_account_id=row["id"])

    for row in bind.execute(sa.text("SELECT id, tenant_id, access_json FROM tenant_calendars")).mappings():
        try:
            access = json.loads(row["access_json"] or "[]")
        except json.JSONDecodeError:
            access = []
        if isinstance(access, list):
            _grant_rows(bind, row, "calendar", access, calendar_id=row["id"])

    for row in bind.execute(
        sa.text("SELECT id, tenant_id, metadata_json FROM integration_connections")
    ).mappings():
        try:
            meta = json.loads(row["metadata_json"] or "{}")
        except json.JSONDecodeError:
            meta = {}
        access = meta.get("access") if isinstance(meta, dict) and isinstance(meta.get("access"), list) else []
        _grant_rows(bind, row, "connection", access, connection_id=row["id"])

    for row in bind.execute(
        sa.text("SELECT id, tenant_id, user_access_json FROM module_installs")
    ).mappings():
        try:
            saved = json.loads(row["user_access_json"] or "{}")
        except json.JSONDecodeError:
            saved = {}
        if not isinstance(saved, dict) or not saved:
            continue
        mode = str(saved.get("mode") or "all_members")
        if mode == "selected":
            entries = [{"kind": "user", "id": item, "level": "use"} for item in saved.get("user_ids") or []]
        else:
            entries = [{"kind": "department", "id": "people", "level": "use"}]
        _grant_rows(bind, row, "module", entries, module_install_id=row["id"])

    for row in bind.execute(
        sa.text("SELECT id, tenant_id, stages_json FROM workstreams")
    ).mappings():
        try:
            stages = json.loads(row["stages_json"] or "[]")
        except json.JSONDecodeError:
            stages = []
        if not isinstance(stages, list):
            continue
        seen = set()
        for position, stage in enumerate(stages):
            if not isinstance(stage, dict):
                continue
            key = str(stage.get("key") or "open")[:64]
            if key in seen:
                continue
            seen.add(key)
            stage_id = uuid.uuid4()
            bind.execute(
                sa.text(
                    "INSERT INTO workstream_stages "
                    "(id, tenant_id, workstream_id, key, position, name, kind, checkup_minutes, created_at) "
                    "VALUES (:id, :tenant_id, :workstream_id, :key, :position, :name, :kind, :checkup, :created)"
                ),
                {
                    "id": stage_id,
                    "tenant_id": row["tenant_id"],
                    "workstream_id": row["id"],
                    "key": key,
                    "position": position,
                    "name": str(stage.get("name") or "")[:120],
                    "kind": str(stage.get("kind") or "open")[:16],
                    "checkup": int(stage.get("checkup_minutes") or 0),
                    "created": now,
                },
            )
            owner = stage.get("owner") if isinstance(stage.get("owner"), dict) else None
            if not owner:
                continue
            kind = "department" if owner.get("kind") == "team" else str(owner.get("kind") or "")
            ident = _uuid(owner.get("id"))
            if ident is None or kind not in ("user", "agent", "department"):
                continue
            bind.execute(
                sa.text(
                    "INSERT INTO workstream_stage_owners "
                    "(id, tenant_id, stage_id, user_id, agent_id, department_id, created_at) "
                    "VALUES (:id, :tenant_id, :stage_id, :user_id, :agent_id, :department_id, :created)"
                ),
                {
                    "id": uuid.uuid4(),
                    "tenant_id": row["tenant_id"],
                    "stage_id": stage_id,
                    "user_id": ident if kind == "user" else None,
                    "agent_id": ident if kind == "agent" else None,
                    "department_id": ident if kind == "department" else None,
                    "created": now,
                },
            )

    for row in bind.execute(
        sa.text(
            "SELECT id, resource_id FROM agent_scopes "
            "WHERE resource_kind = 'connection' AND connection_id IS NULL"
        )
    ).mappings():
        ident = _uuid(row["resource_id"])
        if ident is None:
            continue
        bind.execute(
            sa.text("UPDATE agent_scopes SET connection_id = :connection_id WHERE id = :id"),
            {"id": row["id"], "connection_id": ident},
        )


def _grant_rows(bind, row, resource_kind, entries, **resource_ids) -> None:
    tenant_id = row.get("tenant_id")
    if tenant_id is None:
        found = bind.execute(
            sa.text("SELECT tenant_id FROM channel_accounts WHERE id = :id"),
            {"id": row["id"]},
        ).scalar()
        tenant_id = found
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        kind = str(entry.get("kind") or "")
        ident = str(entry.get("id") or "")
        level = str(entry.get("level") or "use")[:16]
        principal = kind
        user_id = agent_id = department_id = None
        if kind == "department" and ident in ("people", "agents"):
            principal = "everyone_people" if ident == "people" else "everyone_agents"
        elif kind == "user":
            user_id = _uuid(ident)
        elif kind == "agent":
            agent_id = _uuid(ident)
        elif kind == "department":
            department_id = _uuid(ident)
        else:
            continue
        if kind in ("user", "agent", "department") and ident not in ("people", "agents"):
            if user_id is None and agent_id is None and department_id is None:
                continue
        bind.execute(
            sa.text(
                "INSERT INTO resource_grants (id, tenant_id, resource_kind, channel_account_id, "
                "calendar_id, connection_id, module_install_id, principal_kind, user_id, agent_id, "
                "department_id, level, created_at) VALUES (:id, :tenant_id, :resource_kind, "
                ":channel_account_id, :calendar_id, :connection_id, :module_install_id, "
                ":principal_kind, :user_id, :agent_id, :department_id, :level, :created)"
            ),
            {
                "id": uuid.uuid4(),
                "tenant_id": tenant_id,
                "resource_kind": resource_kind,
                "channel_account_id": resource_ids.get("channel_account_id"),
                "calendar_id": resource_ids.get("calendar_id"),
                "connection_id": resource_ids.get("connection_id"),
                "module_install_id": resource_ids.get("module_install_id"),
                "principal_kind": principal,
                "user_id": user_id,
                "agent_id": agent_id,
                "department_id": department_id,
                "level": level,
                "created": datetime.utcnow(),
            },
        )


def downgrade() -> None:
    op.drop_table("workstream_channels")
    op.drop_table("workstream_connections")
    op.drop_table("workstream_stage_owners")
    op.drop_table("workstream_stages")
    op.drop_table("resource_grants")
    op.drop_constraint("fk_agent_scopes_connection", "agent_scopes", type_="foreignkey")
    op.drop_index("ix_agent_scopes_connection_id", table_name="agent_scopes")
    op.drop_column("agent_scopes", "connection_id")
    op.drop_constraint("fk_webhook_endpoints_workstream", "webhook_endpoints", type_="foreignkey")
    op.drop_index("ix_webhook_endpoints_workstream_id", table_name="webhook_endpoints")
    op.drop_column("webhook_endpoints", "workstream_id")
    op.drop_constraint("fk_projects_department", "projects", type_="foreignkey")
    op.drop_index("ix_projects_department_id", table_name="projects")
    op.drop_column("projects", "department_id")
    op.drop_constraint("fk_channel_accounts_routing_user", "channel_accounts", type_="foreignkey")
    op.drop_constraint("fk_channel_accounts_routing_department", "channel_accounts", type_="foreignkey")
    op.drop_index("ix_channel_accounts_routing_user_id", table_name="channel_accounts")
    op.drop_index("ix_channel_accounts_routing_department_id", table_name="channel_accounts")
    op.drop_column("channel_accounts", "routing_user_id")
    op.drop_column("channel_accounts", "routing_department_id")
