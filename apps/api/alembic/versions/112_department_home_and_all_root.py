"""Department home columns, All root, drop system people/agents teams.

Revision ID: 112_department_home_and_all_root
Revises: 111_drop_saved_replies

- departments.parent_id (self-FK)
- nullable department_id on calendars, connections, flows, labels, docs,
  sources, module installs, canvases
- unique (tenant_id, department_id) on module_installs when set
- per-tenant All root; reparent custom departments; rewrite access grants
  that used people/agents string ids; delete kind people/agents rows
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision = "112_department_home_and_all_root"
down_revision = "111_drop_saved_replies"
branch_labels = None
depends_on = None

HOME_TABLES = (
    "tenant_calendars",
    "integration_connections",
    "workstreams",
    "signal_tags",
    "workspace_docs",
    "module_sources",
    "module_installs",
    "project_canvases",
)


def _columns(inspector: sa.Inspector, table: str) -> set[str]:
    if table not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(table)}


def _indexes(inspector: sa.Inspector, table: str) -> set[str]:
    if table not in inspector.get_table_names():
        return set()
    return {i["name"] for i in inspector.get_indexes(table) if i.get("name")}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "departments" in tables and "parent_id" not in _columns(inspector, "departments"):
        op.add_column("departments", sa.Column("parent_id", sa.Uuid(), nullable=True))
        op.create_index("ix_departments_parent_id", "departments", ["parent_id"])
        op.create_foreign_key(
            "fk_departments_parent_id",
            "departments",
            "departments",
            ["parent_id"],
            ["id"],
            ondelete="SET NULL",
        )

    for table in HOME_TABLES:
        if table not in tables:
            continue
        cols = _columns(inspector, table)
        if "department_id" in cols:
            continue
        op.add_column(table, sa.Column("department_id", sa.Uuid(), nullable=True))
        op.create_index(f"ix_{table}_department_id", table, ["department_id"])
        op.create_foreign_key(
            f"fk_{table}_department_id",
            table,
            "departments",
            ["department_id"],
            ["id"],
            ondelete="SET NULL",
        )

    inspector = sa.inspect(bind)
    if "module_installs" in tables:
        idxs = _indexes(inspector, "module_installs")
        if "uq_module_installs_tenant_department" not in idxs:
            op.create_index(
                "uq_module_installs_tenant_department",
                "module_installs",
                ["tenant_id", "department_id"],
                unique=True,
                postgresql_where=sa.text("department_id IS NOT NULL"),
                sqlite_where=sa.text("department_id IS NOT NULL"),
            )

    _migrate_all_root(bind)

    if "saved_replies" in inspector.get_table_names():
        if "trash_entries" in tables:
            op.execute(sa.text("DELETE FROM trash_entries WHERE resource_type = 'saved_reply'"))
        op.drop_table("saved_replies")


def _migrate_all_root(bind) -> None:
    departments = sa.table(
        "departments",
        sa.column("id", sa.Uuid()),
        sa.column("tenant_id", sa.Uuid()),
        sa.column("name", sa.String()),
        sa.column("description", sa.String()),
        sa.column("kind", sa.String()),
        sa.column("pickup", sa.String()),
        sa.column("pinned", sa.Boolean()),
        sa.column("last_pick", sa.String()),
        sa.column("settings_json", sa.String()),
        sa.column("parent_id", sa.Uuid()),
        sa.column("created_at", sa.DateTime()),
        sa.column("updated_at", sa.DateTime()),
        sa.column("deleted_at", sa.DateTime()),
    )
    members = sa.table(
        "department_members",
        sa.column("id", sa.Uuid()),
        sa.column("tenant_id", sa.Uuid()),
        sa.column("department_id", sa.Uuid()),
        sa.column("member_kind", sa.String()),
        sa.column("user_id", sa.Uuid()),
        sa.column("agent_id", sa.Uuid()),
        sa.column("duty", sa.String()),
        sa.column("position", sa.Integer()),
        sa.column("created_at", sa.DateTime()),
    )
    now = datetime.utcnow()

    tenant_ids = [row[0] for row in bind.execute(sa.text("SELECT id FROM tenants")).fetchall()]
    for tenant_id in tenant_ids:
        rows = bind.execute(
            sa.select(departments).where(
                departments.c.tenant_id == tenant_id,
                departments.c.deleted_at.is_(None),
            )
        ).mappings().all()
        by_kind = {}
        customs = []
        all_row = None
        for row in rows:
            kind = row["kind"]
            if kind in ("people", "agents"):
                by_kind[kind] = row
            elif row["parent_id"] is None and row["name"] == "All" and kind == "custom":
                all_row = row
            else:
                customs.append(row)

        if all_row is None:
            all_id = uuid.uuid4()
            bind.execute(
                sa.insert(departments).values(
                    id=all_id,
                    tenant_id=tenant_id,
                    name="All",
                    description="",
                    kind="custom",
                    pickup="people",
                    pinned=True,
                    last_pick="",
                    settings_json="{}",
                    parent_id=None,
                    created_at=now,
                    updated_at=now,
                    deleted_at=None,
                )
            )
        else:
            all_id = all_row["id"]
            if not all_row["pinned"]:
                bind.execute(
                    sa.update(departments)
                    .where(departments.c.id == all_id)
                    .values(pinned=True, updated_at=now)
                )

        for row in customs:
            if row["id"] == all_id:
                continue
            if row["parent_id"] is None:
                bind.execute(
                    sa.update(departments)
                    .where(departments.c.id == row["id"])
                    .values(parent_id=all_id, updated_at=now)
                )

        people_id = by_kind["people"]["id"] if "people" in by_kind else None
        agents_id = by_kind["agents"]["id"] if "agents" in by_kind else None
        rewrite_ids = {str(x) for x in (people_id, agents_id) if x is not None}
        rewrite_ids.update({"people", "agents"})

        _rewrite_json_access(bind, tenant_id, all_id, rewrite_ids)
        _rewrite_resource_grants(bind, tenant_id, all_id, people_id, agents_id)
        _repoint_department_refs(bind, tenant_id, all_id, people_id, agents_id)
        _seed_all_members(bind, members, tenant_id, all_id, now)

        for kind in ("people", "agents"):
            row = by_kind.get(kind)
            if row is None:
                continue
            bind.execute(
                sa.delete(members).where(members.c.department_id == row["id"])
            )
            bind.execute(sa.delete(departments).where(departments.c.id == row["id"]))


def _rewrite_json_access(bind, tenant_id, all_id: uuid.UUID, rewrite_ids: set[str]) -> None:
    all_s = str(all_id)

    # Channel settings_json.access
    channels = bind.execute(
        sa.text(
            "SELECT id, settings_json FROM channel_accounts WHERE tenant_id = :tid"
        ),
        {"tid": tenant_id},
    ).fetchall()
    for cid, raw in channels:
        try:
            data = json.loads(raw or "{}")
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(data, dict) or not isinstance(data.get("access"), list):
            continue
        new_access, changed = _map_access_entries(data["access"], rewrite_ids, all_s)
        if not changed:
            continue
        data["access"] = new_access
        bind.execute(
            sa.text("UPDATE channel_accounts SET settings_json = :j WHERE id = :id"),
            {"j": json.dumps(data), "id": cid},
        )

    # Connection metadata_json.access
    conns = bind.execute(
        sa.text(
            "SELECT id, metadata_json FROM integration_connections WHERE tenant_id = :tid"
        ),
        {"tid": tenant_id},
    ).fetchall()
    for cid, raw in conns:
        try:
            data = json.loads(raw or "{}")
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(data, dict) or not isinstance(data.get("access"), list):
            continue
        new_access, changed = _map_access_entries(data["access"], rewrite_ids, all_s)
        if not changed:
            continue
        data["access"] = new_access
        bind.execute(
            sa.text("UPDATE integration_connections SET metadata_json = :j WHERE id = :id"),
            {"j": json.dumps(data), "id": cid},
        )

    # Calendar access_json
    cals = bind.execute(
        sa.text("SELECT id, access_json FROM tenant_calendars WHERE tenant_id = :tid"),
        {"tid": tenant_id},
    ).fetchall()
    for cid, raw in cals:
        try:
            data = json.loads(raw or "[]")
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(data, list) or not data:
            continue
        new_access, changed = _map_access_entries(data, rewrite_ids, all_s)
        if not changed:
            continue
        bind.execute(
            sa.text("UPDATE tenant_calendars SET access_json = :j WHERE id = :id"),
            {"j": json.dumps(new_access), "id": cid},
        )


def _map_access_entries(
    entries: list, rewrite_ids: set[str], all_id: str
) -> tuple[list[dict], bool]:
    out: list[dict] = []
    seen: set[tuple[str, str]] = set()
    changed = False
    has_all = False
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        kind = str(entry.get("kind") or "")
        ident = str(entry.get("id") or "")
        level = str(entry.get("level") or "")
        if kind == "department" and ident in rewrite_ids:
            ident = all_id
            changed = True
            has_all = True
        key = (kind, ident)
        if key in seen:
            changed = True
            continue
        seen.add(key)
        if kind == "department" and ident == all_id:
            has_all = True
        out.append({"kind": kind, "id": ident, "level": level})
    if has_all:
        # Collapse duplicate All grants; keep highest level already handled by seen.
        pass
    return out, changed


def _rewrite_resource_grants(bind, tenant_id, all_id, people_id, agents_id) -> None:
    # everyone_people / everyone_agents → department All
    bind.execute(
        sa.text(
            """
            UPDATE resource_grants
            SET principal_kind = 'department', department_id = :all_id
            WHERE tenant_id = :tid
              AND principal_kind IN ('everyone_people', 'everyone_agents')
            """
        ),
        {"all_id": all_id, "tid": tenant_id},
    )
    for old_id in (people_id, agents_id):
        if old_id is None:
            continue
        bind.execute(
            sa.text(
                """
                UPDATE resource_grants
                SET department_id = :all_id
                WHERE tenant_id = :tid AND department_id = :old_id
                """
            ),
            {"all_id": all_id, "tid": tenant_id, "old_id": old_id},
        )


def _repoint_department_refs(bind, tenant_id, all_id, people_id, agents_id) -> None:
    old_ids = [x for x in (people_id, agents_id) if x is not None]
    if not old_ids:
        return
    for old_id in old_ids:
        params = {"all_id": all_id, "tid": tenant_id, "old_id": old_id}
        bind.execute(
            sa.text(
                """
                UPDATE signals SET assignee_id = :all_id
                WHERE tenant_id = :tid AND assignee_kind = 'department' AND assignee_id = :old_id
                """
            ),
            params,
        )
        bind.execute(
            sa.text(
                """
                UPDATE signals SET turn_ref_id = :all_id
                WHERE tenant_id = :tid AND turn_kind = 'department' AND turn_ref_id = :old_id
                """
            ),
            params,
        )
        bind.execute(
            sa.text(
                """
                UPDATE channel_accounts SET routing_department_id = :all_id
                WHERE tenant_id = :tid AND routing_department_id = :old_id
                """
            ),
            params,
        )
        bind.execute(
            sa.text(
                """
                UPDATE contacts SET owner_department_id = :all_id
                WHERE tenant_id = :tid AND owner_department_id = :old_id
                """
            ),
            params,
        )
        bind.execute(
            sa.text(
                """
                UPDATE decision_requests SET addressee_department_id = :all_id
                WHERE tenant_id = :tid AND addressee_department_id = :old_id
                """
            ),
            params,
        )
        bind.execute(
            sa.text(
                """
                UPDATE triggers SET recipient_department_id = :all_id
                WHERE tenant_id = :tid AND recipient_department_id = :old_id
                """
            ),
            params,
        )
        bind.execute(
            sa.text(
                """
                UPDATE workstream_stage_owners SET department_id = :all_id
                WHERE department_id = :old_id
                """
            ),
            {"all_id": all_id, "old_id": old_id},
        )
        bind.execute(
            sa.text(
                """
                UPDATE projects SET department_id = :all_id
                WHERE tenant_id = :tid AND department_id = :old_id
                """
            ),
            params,
        )


def _seed_all_members(bind, members, tenant_id, all_id, now) -> None:
    position = int(
        bind.execute(
            sa.text(
                "SELECT COALESCE(MAX(position), -1) + 1 FROM department_members WHERE department_id = :did"
            ),
            {"did": all_id},
        ).scalar()
        or 0
    )
    users = bind.execute(
        sa.text(
            """
            SELECT m.user_id FROM memberships m
            JOIN users u ON u.id = m.user_id
            WHERE m.tenant_id = :tid AND m.is_active IS TRUE AND u.is_active IS TRUE
              AND NOT EXISTS (
                SELECT 1 FROM department_members dm
                WHERE dm.department_id = :did AND dm.member_kind = 'user' AND dm.user_id = m.user_id
              )
            """
        ),
        {"tid": tenant_id, "did": all_id},
    ).fetchall()
    for (uid,) in users:
        bind.execute(
            sa.insert(members).values(
                id=uuid.uuid4(),
                tenant_id=tenant_id,
                department_id=all_id,
                member_kind="user",
                user_id=uid,
                agent_id=None,
                duty="member",
                position=position,
                created_at=now,
            )
        )
        position += 1

    agents = bind.execute(
        sa.text(
            """
            SELECT id FROM agents
            WHERE tenant_id = :tid AND is_active IS TRUE AND kind = 'company'
              AND acts_for_user IS FALSE
              AND NOT EXISTS (
                SELECT 1 FROM department_members dm
                WHERE dm.department_id = :did AND dm.member_kind = 'agent' AND dm.agent_id = agents.id
              )
            """
        ),
        {"tid": tenant_id, "did": all_id},
    ).fetchall()
    for (aid,) in agents:
        bind.execute(
            sa.insert(members).values(
                id=uuid.uuid4(),
                tenant_id=tenant_id,
                department_id=all_id,
                member_kind="agent",
                user_id=None,
                agent_id=aid,
                duty="member",
                position=position,
                created_at=now,
            )
        )
        position += 1


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "module_installs" in inspector.get_table_names():
        if "uq_module_installs_tenant_department" in _indexes(inspector, "module_installs"):
            op.drop_index("uq_module_installs_tenant_department", table_name="module_installs")
    for table in HOME_TABLES:
        if table not in inspector.get_table_names():
            continue
        cols = _columns(inspector, table)
        if "department_id" not in cols:
            continue
        try:
            op.drop_constraint(f"fk_{table}_department_id", table, type_="foreignkey")
        except Exception:
            pass
        try:
            op.drop_index(f"ix_{table}_department_id", table_name=table)
        except Exception:
            pass
        op.drop_column(table, "department_id")
    if "departments" in inspector.get_table_names() and "parent_id" in _columns(
        inspector, "departments"
    ):
        try:
            op.drop_constraint("fk_departments_parent_id", "departments", type_="foreignkey")
        except Exception:
            pass
        try:
            op.drop_index("ix_departments_parent_id", table_name="departments")
        except Exception:
            pass
        op.drop_column("departments", "parent_id")
