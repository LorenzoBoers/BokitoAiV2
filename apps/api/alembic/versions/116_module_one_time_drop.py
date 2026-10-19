"""Module one-time drop: origin on department, drop ModuleInstall.

Revision ID: 116_module_one_time_drop
Revises: 115_drop_agent_managed

- departments.origin_module_slug (+ unique live index)
- backfill from module_installs.department_id / module_slug
- copy prefs into department settings_json.modules
- resource_grants.module_slug; drop module_install_id
- drop module_installs
"""

from __future__ import annotations

import json
import uuid

import sqlalchemy as sa
from alembic import op

revision = "116_module_one_time_drop"
down_revision = "115_drop_agent_managed"
branch_labels = None
depends_on = None


def _columns(inspector: sa.Inspector, table: str) -> set[str]:
    if table not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "departments" in tables and "origin_module_slug" not in _columns(inspector, "departments"):
        op.add_column(
            "departments",
            sa.Column("origin_module_slug", sa.String(length=64), nullable=True),
        )
        op.create_index(
            "ix_departments_origin_module_slug",
            "departments",
            ["origin_module_slug"],
        )

    # Backfill origin + prefs before unique index (needs clean data).
    if "module_installs" in tables and "departments" in tables:
        installs = bind.execute(
            sa.text(
                "SELECT id, tenant_id, module_slug, department_id, install_state, "
                "writes_enabled, default_connection_id, default_company_json, "
                "user_access_json, customer_tools_json "
                "FROM module_installs "
                "WHERE install_state IN ('setup', 'installed') "
                "AND department_id IS NOT NULL"
            )
        ).mappings().all()
        for row in installs:
            dept_id = row["department_id"]
            slug = str(row["module_slug"] or "").strip()
            if not slug or dept_id is None:
                continue
            existing = bind.execute(
                sa.text(
                    "SELECT settings_json FROM departments "
                    "WHERE id = :id AND deleted_at IS NULL"
                ),
                {"id": dept_id},
            ).scalar()
            if existing is None:
                continue
            try:
                settings = json.loads(existing or "{}")
            except json.JSONDecodeError:
                settings = {}
            if not isinstance(settings, dict):
                settings = {}
            mods = settings.get("modules")
            if not isinstance(mods, dict):
                mods = {}
            mods["writes_enabled"] = bool(row["writes_enabled"])
            if row["default_connection_id"]:
                mods["default_connection_id"] = str(row["default_connection_id"])
            try:
                company = json.loads(row["default_company_json"] or "{}")
            except json.JSONDecodeError:
                company = {}
            if isinstance(company, dict) and company:
                mods["default_company_by_connection"] = company
            try:
                access = json.loads(row["user_access_json"] or "{}")
            except json.JSONDecodeError:
                access = {}
            if isinstance(access, dict) and access:
                mods["user_access"] = access
            try:
                tools = json.loads(row["customer_tools_json"] or "{}")
            except json.JSONDecodeError:
                tools = {}
            if isinstance(tools, dict) and tools:
                mods["customer_tools"] = tools
            settings["modules"] = mods
            bind.execute(
                sa.text(
                    "UPDATE departments SET origin_module_slug = :slug, "
                    "settings_json = :settings WHERE id = :id"
                ),
                {
                    "slug": slug,
                    "settings": json.dumps(settings),
                    "id": dept_id,
                },
            )

        # Installs without department: create origin stamp is skipped (orphan);
        # they will show as not installed until re-install.

    # Unique live (tenant, origin_module_slug).
    indexes = {
        i["name"]
        for i in (inspector.get_indexes("departments") if "departments" in tables else [])
    }
    if "departments" in tables and "uq_departments_tenant_origin_module" not in indexes:
        dialect = bind.dialect.name
        if dialect == "postgresql":
            op.execute(
                sa.text(
                    "CREATE UNIQUE INDEX uq_departments_tenant_origin_module "
                    "ON departments (tenant_id, origin_module_slug) "
                    "WHERE origin_module_slug IS NOT NULL AND deleted_at IS NULL"
                )
            )
        else:
            # SQLite: partial unique via filtered index when supported.
            try:
                op.execute(
                    sa.text(
                        "CREATE UNIQUE INDEX uq_departments_tenant_origin_module "
                        "ON departments (tenant_id, origin_module_slug) "
                        "WHERE origin_module_slug IS NOT NULL AND deleted_at IS NULL"
                    )
                )
            except Exception:  # noqa: BLE001
                op.create_index(
                    "uq_departments_tenant_origin_module",
                    "departments",
                    ["tenant_id", "origin_module_slug"],
                    unique=False,
                )

    # Resource grants: module_slug instead of module_install_id.
    if "resource_grants" in tables:
        rg_cols = _columns(inspector, "resource_grants")
        if "module_slug" not in rg_cols:
            op.add_column(
                "resource_grants",
                sa.Column("module_slug", sa.String(length=64), nullable=True),
            )
            op.create_index(
                "ix_resource_grants_module_slug",
                "resource_grants",
                ["module_slug"],
            )
        if "module_install_id" in rg_cols and "module_installs" in tables:
            bind.execute(
                sa.text(
                    "UPDATE resource_grants SET module_slug = ("
                    "  SELECT module_slug FROM module_installs "
                    "  WHERE module_installs.id = resource_grants.module_install_id"
                    ") WHERE module_install_id IS NOT NULL"
                )
            )
            # Drop FK + column.
            fks = {
                fk["name"]
                for fk in inspector.get_foreign_keys("resource_grants")
                if fk.get("name")
            }
            for name in list(fks):
                if name and "module_install" in name:
                    try:
                        op.drop_constraint(name, "resource_grants", type_="foreignkey")
                    except Exception:  # noqa: BLE001
                        pass
            idx = {
                i["name"]
                for i in inspector.get_indexes("resource_grants")
                if i.get("name")
            }
            if "ix_resource_grants_module_install_id" in idx:
                op.drop_index(
                    "ix_resource_grants_module_install_id",
                    table_name="resource_grants",
                )
            op.drop_column("resource_grants", "module_install_id")

    if "module_installs" in tables:
        op.drop_table("module_installs")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "module_installs" not in tables:
        op.create_table(
            "module_installs",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("tenant_id", sa.Uuid(), nullable=False),
            sa.Column("department_id", sa.Uuid(), nullable=True),
            sa.Column("module_slug", sa.String(length=64), nullable=False),
            sa.Column(
                "install_state",
                sa.String(length=16),
                nullable=False,
                server_default="setup",
            ),
            sa.Column(
                "writes_enabled",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
            sa.Column("default_connection_id", sa.String(length=64), nullable=True),
            sa.Column(
                "default_company_json",
                sa.String(),
                nullable=False,
                server_default="{}",
            ),
            sa.Column(
                "user_access_json",
                sa.String(),
                nullable=False,
                server_default="{}",
            ),
            sa.Column(
                "customer_tools_json",
                sa.String(),
                nullable=False,
                server_default="{}",
            ),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )

    # Best-effort reverse is incomplete; origin column stays.
    del uuid  # unused in downgrade body beyond table create
