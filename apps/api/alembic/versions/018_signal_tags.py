"""Tag registry: tags become a managed tenant vocabulary instead of a derived list.

`signal_tags` holds one row per tag a tenant uses, so a tag can be created in
settings before any thread carries it, can hold a description that steers AI
tagging, and survives its last thread being retagged. Existing tag names on
`signals.tags_json` are backfilled (normalized to lower case).

Revision ID: 018_signal_tags
Revises: 017_channel_registry
"""

import json
import uuid
from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision = "018_signal_tags"
down_revision = "017_channel_registry"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("signal_tags"):
        op.create_table(
            "signal_tags",
            sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
            sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
            sa.Column("name", sa.String(), nullable=False, server_default=""),
            sa.Column("description", sa.String(), nullable=False, server_default=""),
            sa.Column(
                "created_by_user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True
            ),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_signal_tags_tenant_id", "signal_tags", ["tenant_id"])
        op.create_index("ix_signal_tags_name", "signal_tags", ["name"])

    if not inspector.has_table("signals"):
        return

    now = datetime.utcnow()
    rows = bind.execute(
        sa.text(
            "SELECT tenant_id, tags_json FROM signals "
            "WHERE tags_json IS NOT NULL AND tags_json != '[]'"
        )
    ).fetchall()
    seen: set[tuple[str, str]] = set()
    for row in rows:
        try:
            tags = json.loads(row.tags_json or "[]")
        except (TypeError, ValueError):
            continue
        if not isinstance(tags, list):
            continue
        for raw in tags:
            if not isinstance(raw, str):
                continue
            name = " ".join(raw.split()).strip().lower()[:40]
            if not name:
                continue
            seen.add((str(row.tenant_id), name))

    for tenant_id, name in sorted(seen):
        exists = bind.execute(
            sa.text(
                "SELECT 1 FROM signal_tags WHERE tenant_id = :tenant_id AND name = :name"
            ),
            {"tenant_id": tenant_id, "name": name},
        ).first()
        if exists:
            continue
        bind.execute(
            sa.text(
                "INSERT INTO signal_tags "
                "(id, tenant_id, name, description, created_at, updated_at) "
                "VALUES (:id, :tenant_id, :name, '', :created_at, :updated_at)"
            ),
            {
                "id": str(uuid.uuid4()),
                "tenant_id": tenant_id,
                "name": name,
                "created_at": now,
                "updated_at": now,
            },
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("signal_tags"):
        op.drop_table("signal_tags")
