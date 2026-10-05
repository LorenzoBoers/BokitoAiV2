"""Conversation tags become a join table on the tag registry.

- ``signal_tag_links (signal_id, tag_id)`` replaces the JSON array in
  ``signals.tags_json``; every name in use is registered in ``signal_tags``
- Drops ``signals.tags_json``

Revision ID: 073_signal_tag_links
Revises: 072_conversation_split
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision = "073_signal_tag_links"
down_revision = "072_conversation_split"
branch_labels = None
depends_on = None

MAX_TAG_LEN = 40


def _normalize(raw: object) -> str:
    if not isinstance(raw, str):
        return ""
    return " ".join(raw.split()).strip().lower()[:MAX_TAG_LEN]


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("signal_tag_links"):
        op.create_table(
            "signal_tag_links",
            sa.Column("signal_id", sa.Uuid(), sa.ForeignKey("signals.id"), primary_key=True),
            sa.Column("tag_id", sa.Uuid(), sa.ForeignKey("signal_tags.id"), primary_key=True),
            sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_signal_tag_links_tag_id", "signal_tag_links", ["tag_id"])
        op.create_index("ix_signal_tag_links_tenant_id", "signal_tag_links", ["tenant_id"])

    if "tags_json" not in {c["name"] for c in inspector.get_columns("signals")}:
        return

    signals = sa.table(
        "signals", sa.column("id", sa.Uuid()), sa.column("tenant_id", sa.Uuid()),
        sa.column("tags_json", sa.String()),
    )
    tags = sa.table(
        "signal_tags", sa.column("id", sa.Uuid()), sa.column("tenant_id", sa.Uuid()),
        sa.column("name", sa.String()), sa.column("description", sa.String()),
        sa.column("created_at", sa.DateTime()), sa.column("updated_at", sa.DateTime()),
    )
    links = sa.table(
        "signal_tag_links", sa.column("signal_id", sa.Uuid()), sa.column("tag_id", sa.Uuid()),
        sa.column("tenant_id", sa.Uuid()), sa.column("created_at", sa.DateTime()),
    )
    registry: dict[tuple[str, str], uuid.UUID] = {}
    for row in bind.execute(sa.select(tags.c.id, tags.c.tenant_id, tags.c.name)):
        registry[(str(row.tenant_id), row.name)] = row.id

    now = datetime.utcnow()
    rows = bind.execute(
        sa.select(signals.c.id, signals.c.tenant_id, signals.c.tags_json).where(
            signals.c.tags_json.is_not(None), signals.c.tags_json != "[]", signals.c.tags_json != ""
        )
    ).all()
    for row in rows:
        try:
            names = json.loads(row.tags_json or "[]")
        except (json.JSONDecodeError, TypeError):
            continue
        seen: set[str] = set()
        for raw in names if isinstance(names, list) else []:
            name = _normalize(raw)
            if not name or name in seen:
                continue
            seen.add(name)
            key = (str(row.tenant_id), name)
            tag_id = registry.get(key)
            if tag_id is None:
                tag_id = uuid.uuid4()
                bind.execute(
                    tags.insert().values(
                        id=tag_id, tenant_id=row.tenant_id, name=name, description="",
                        created_at=now, updated_at=now,
                    )
                )
                registry[key] = tag_id
            bind.execute(
                links.insert().values(
                    signal_id=row.id, tag_id=tag_id, tenant_id=row.tenant_id, created_at=now
                )
            )

    with op.batch_alter_table("signals") as batch:
        batch.drop_column("tags_json")


def downgrade() -> None:
    with op.batch_alter_table("signals") as batch:
        batch.add_column(sa.Column("tags_json", sa.String(), nullable=False, server_default="[]"))
    op.drop_index("ix_signal_tag_links_tenant_id", table_name="signal_tag_links")
    op.drop_index("ix_signal_tag_links_tag_id", table_name="signal_tag_links")
    op.drop_table("signal_tag_links")
