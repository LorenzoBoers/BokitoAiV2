"""Every workspace gets a folder for loose work; canvases always live in a folder.

Revision ID: 126_general_folder
Revises: 125_stage_source

1. Each tenant gets a root folder "Algemeen" (NL) or "General" (EN) when it
   has none yet.
2. A ProjectResource whose folder row no longer exists moves to that folder:
   a resource without a folder does not exist.
3. Workspace canvases (owner_kind='tenant') move into that folder. A slug that
   is already taken there gets a "-workspace" suffix.

Changed values and the ids of created folders go to schema_value_backups; the
downgrade puts canvases back and moves the created folders to the bin.
Resources keep their new folder, because their old folder row is gone.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime

import sqlalchemy as sa
from alembic import op

from app.db import value_backups

revision = "126_general_folder"
down_revision = "125_stage_source"
branch_labels = None
depends_on = None

NAMES = {"nl": "Algemeen", "en": "General"}
SLUGS = {"nl": "algemeen", "en": "general"}
ROW_BACKUP = "owner"


def _language(settings_json: str | None) -> str:
    try:
        data = json.loads(settings_json or "{}")
    except json.JSONDecodeError:
        data = {}
    lang = str(data.get("ai_workspace_language") or data.get("ui_language") or "") if isinstance(data, dict) else ""
    return "nl" if lang.lower().startswith("nl") else "en"


def _id_value(bind, value: uuid.UUID):
    return value if bind.dialect.name == "postgresql" else value.hex


def _general_folder(bind, tenant_id, language: str) -> tuple[object, bool]:
    existing = bind.execute(
        sa.text(
            "SELECT id FROM projects WHERE tenant_id = :t AND parent_id IS NULL "
            "AND deleted_at IS NULL AND name IN ('Algemeen', 'General') ORDER BY created_at LIMIT 1"
        ),
        {"t": tenant_id},
    ).scalar()
    if existing is not None:
        return existing, False
    slug = SLUGS[language]
    taken = {
        row[0]
        for row in bind.execute(
            sa.text("SELECT slug FROM projects WHERE tenant_id = :t AND slug LIKE :s"),
            {"t": tenant_id, "s": f"{slug}%"},
        )
    }
    candidate, n = slug, 2
    while candidate in taken:
        candidate, n = f"{slug}-{n}", n + 1
    new_id = _id_value(bind, uuid.uuid4())
    now = datetime.utcnow()
    bind.execute(
        sa.text(
            "INSERT INTO projects (id, tenant_id, name, slug, description, autonomous_scope, "
            "active_domains_json, sort_order, created_at, updated_at) VALUES "
            "(:id, :t, :name, :slug, '', '', '[]', 0, :now, :now)"
        ),
        {"id": new_id, "t": tenant_id, "name": NAMES[language], "slug": candidate, "now": now},
    )
    return new_id, True


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    if "projects" not in tables or "tenants" not in tables:
        return
    value_backups.ensure_table(bind)
    tenants = bind.execute(sa.text("SELECT id, settings_json FROM tenants")).fetchall()
    for tenant_id, settings_json in tenants:
        folder_id, created = _general_folder(bind, tenant_id, _language(settings_json))
        if created:
            value_backups.write_values(bind, revision, "projects", [(folder_id, "created", True, tenant_id)])

        if "project_resources" in tables:
            orphans = bind.execute(
                sa.text(
                    "SELECT id FROM project_resources WHERE tenant_id = :t "
                    "AND project_id NOT IN (SELECT id FROM projects)"
                ),
                {"t": tenant_id},
            ).fetchall()
            for (resource_id,) in orphans:
                bind.execute(
                    sa.text("UPDATE project_resources SET project_id = :f WHERE id = :id"),
                    {"f": folder_id, "id": resource_id},
                )
            if orphans:
                print(f"tenant {tenant_id}: {len(orphans)} resource(s) moved to the general folder")

        if "project_canvases" not in tables:
            continue
        canvases = bind.execute(
            sa.text(
                "SELECT id, slug, owner_id, project_id, deleted_at FROM project_canvases "
                "WHERE tenant_id = :t AND owner_kind = 'tenant'"
            ),
            {"t": tenant_id},
        ).fetchall()
        taken = {
            row[0]
            for row in bind.execute(
                sa.text(
                    "SELECT slug FROM project_canvases WHERE tenant_id = :t AND owner_kind = 'project' "
                    "AND owner_id = :f AND deleted_at IS NULL"
                ),
                {"t": tenant_id, "f": folder_id},
            )
        }
        for canvas_id, slug, owner_id, project_id, deleted_at in canvases:
            new_slug = slug
            if deleted_at is None:
                n = 1
                while new_slug in taken:
                    new_slug = f"{slug}-workspace" + (f"-{n}" if n > 1 else "")
                    n += 1
                taken.add(new_slug)
            value_backups.write_values(
                bind,
                revision,
                "project_canvases",
                [(canvas_id, ROW_BACKUP, {"slug": slug, "owner_id": str(owner_id), "project_id": project_id and str(project_id)}, tenant_id)],
            )
            bind.execute(
                sa.text(
                    "UPDATE project_canvases SET owner_kind = 'project', owner_id = :f, project_id = :f, "
                    "slug = :slug WHERE id = :id"
                ),
                {"f": folder_id, "slug": new_slug, "id": canvas_id},
            )
        if canvases:
            print(f"tenant {tenant_id}: {len(canvases)} workspace canvas(es) moved to the general folder")


def downgrade() -> None:
    bind = op.get_bind()
    for row_id, value in value_backups.stored_values(bind, revision, "project_canvases", ROW_BACKUP):
        if not isinstance(value, dict):
            continue
        owner = value.get("owner_id")
        bind.execute(
            sa.text(
                "UPDATE project_canvases SET owner_kind = 'tenant', owner_id = :o, project_id = :p, "
                "slug = :slug WHERE CAST(id AS TEXT) = :id"
            ),
            {
                "o": _restore_id(bind, owner),
                "p": _restore_id(bind, value.get("project_id")),
                "slug": value.get("slug") or "main",
                "id": row_id,
            },
        )
    now = datetime.utcnow()
    for row_id, _value in value_backups.stored_values(bind, revision, "projects", "created"):
        bind.execute(
            sa.text("UPDATE projects SET deleted_at = :now WHERE CAST(id AS TEXT) = :id"),
            {"now": now, "id": row_id},
        )
    value_backups.clear(bind, revision)


def _restore_id(bind, raw):
    """Stored ids are the text the upgrade read; Postgres casts them back to uuid."""
    return None if raw is None else str(raw)
