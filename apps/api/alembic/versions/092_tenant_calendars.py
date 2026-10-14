"""First-class tenant calendars with tags and per-calendar access.

Creates ``tenant_calendars`` and ``calendar_tag_links``, adds
``calendar_events.tenant_calendar_id``, and backfills rows from
``integration_connections.metadata_json.calendars``.

Revision ID: 092_tenant_calendars
Revises: 091_folder_filtersets
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision = "092_tenant_calendars"
down_revision = "091_folder_filtersets"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("integration_connections"):
        return

    if not inspector.has_table("tenant_calendars"):
        op.create_table(
            "tenant_calendars",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
            sa.Column(
                "connection_id",
                sa.Uuid(),
                sa.ForeignKey("integration_connections.id"),
                nullable=False,
            ),
            sa.Column("external_id", sa.String(), nullable=False, server_default=""),
            sa.Column("name", sa.String(), nullable=False, server_default=""),
            sa.Column("color", sa.String(), nullable=False, server_default=""),
            sa.Column("is_primary", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("writable", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("sync_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("access_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint(
                "connection_id", "external_id", name="uq_tenant_calendars_connection_external"
            ),
        )
        op.create_index("ix_tenant_calendars_tenant_id", "tenant_calendars", ["tenant_id"])
        op.create_index("ix_tenant_calendars_connection_id", "tenant_calendars", ["connection_id"])
        op.create_index("ix_tenant_calendars_external_id", "tenant_calendars", ["external_id"])

    if not inspector.has_table("calendar_tag_links"):
        op.create_table(
            "calendar_tag_links",
            sa.Column(
                "calendar_id", sa.Uuid(), sa.ForeignKey("tenant_calendars.id"), primary_key=True
            ),
            sa.Column("tag_id", sa.Uuid(), sa.ForeignKey("signal_tags.id"), primary_key=True),
            sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_calendar_tag_links_tag_id", "calendar_tag_links", ["tag_id"])
        op.create_index("ix_calendar_tag_links_tenant_id", "calendar_tag_links", ["tenant_id"])

    inspector = sa.inspect(bind)
    if inspector.has_table("calendar_events"):
        cols = {c["name"] for c in inspector.get_columns("calendar_events")}
        if "tenant_calendar_id" not in cols:
            op.add_column(
                "calendar_events",
                sa.Column("tenant_calendar_id", sa.Uuid(), sa.ForeignKey("tenant_calendars.id")),
            )
            op.create_index(
                "ix_calendar_events_tenant_calendar_id",
                "calendar_events",
                ["tenant_calendar_id"],
            )

    _backfill(bind)


def _backfill(bind) -> None:
    now = datetime.utcnow()
    rows = bind.execute(
        sa.text(
            "SELECT id, tenant_id, provider, metadata_json FROM integration_connections "
            "WHERE status = 'active'"
        )
    ).mappings().all()
    calendar_providers = {"google_calendar", "outlook_calendar", "google", "outlook"}
    for row in rows:
        provider = str(row["provider"] or "")
        if provider not in calendar_providers and "calendar" not in provider:
            continue
        try:
            meta = json.loads(row["metadata_json"] or "{}")
        except json.JSONDecodeError:
            meta = {}
        if not isinstance(meta, dict):
            continue
        calendars = meta.get("calendars")
        if not isinstance(calendars, list):
            continue
        for item in calendars:
            if not isinstance(item, dict) or not item.get("id"):
                continue
            external_id = str(item["id"])
            existing = bind.execute(
                sa.text(
                    "SELECT id FROM tenant_calendars "
                    "WHERE connection_id = :cid AND external_id = :eid"
                ),
                {"cid": row["id"], "eid": external_id},
            ).first()
            if existing:
                cal_id = existing[0]
            else:
                cal_id = uuid.uuid4()
                bind.execute(
                    sa.text(
                        "INSERT INTO tenant_calendars ("
                        "id, tenant_id, connection_id, external_id, name, color, "
                        "is_primary, writable, sync_enabled, access_json, created_at, updated_at"
                        ") VALUES ("
                        ":id, :tenant_id, :connection_id, :external_id, :name, :color, "
                        ":is_primary, :writable, :sync_enabled, :access_json, :created_at, :updated_at"
                        ")"
                    ),
                    {
                        "id": cal_id,
                        "tenant_id": row["tenant_id"],
                        "connection_id": row["id"],
                        "external_id": external_id,
                        "name": str(item.get("name") or external_id),
                        "color": str(item.get("color") or ""),
                        "is_primary": bool(item.get("primary")),
                        "writable": bool(item.get("writable")),
                        "sync_enabled": bool(item.get("enabled")),
                        "access_json": "[]",
                        "created_at": now,
                        "updated_at": now,
                    },
                )
            bind.execute(
                sa.text(
                    "UPDATE calendar_events SET tenant_calendar_id = :cal_id "
                    "WHERE connection_id = :cid AND calendar_id = :eid "
                    "AND tenant_calendar_id IS NULL"
                ),
                {"cal_id": cal_id, "cid": row["id"], "eid": external_id},
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("calendar_events"):
        cols = {c["name"] for c in inspector.get_columns("calendar_events")}
        if "tenant_calendar_id" in cols:
            op.drop_index("ix_calendar_events_tenant_calendar_id", table_name="calendar_events")
            op.drop_column("calendar_events", "tenant_calendar_id")
    if inspector.has_table("calendar_tag_links"):
        op.drop_table("calendar_tag_links")
    if inspector.has_table("tenant_calendars"):
        op.drop_table("tenant_calendars")
