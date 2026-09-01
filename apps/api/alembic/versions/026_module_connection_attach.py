"""Backfill module attachments for existing partner registrations.

Revision ID: 026_module_connection_attach
Revises: 025_drop_agent_pause

Connections stay independent. This one-time pass attaches active rows whose
provider already belongs to a live module spec, so current tenants keep
seeing Moneybird / KING / Björn under Accounting.
"""

import json
import uuid

import sqlalchemy as sa
from alembic import op

revision = "026_module_connection_attach"
down_revision = "025_drop_agent_pause"
branch_labels = None
depends_on = None

PROVIDER_MODULE = {
    "moneybird": "accounting",
    "king_accountancy": "accounting",
    "bjorn_lunden_mcp": "accounting",
    "gocardless_bank": "banking",
}


def upgrade() -> None:
    conn = op.get_bind()
    connections = sa.table(
        "integration_connections",
        sa.column("id", sa.Uuid()),
        sa.column("tenant_id", sa.Uuid()),
        sa.column("provider", sa.String()),
        sa.column("status", sa.String()),
    )
    bindings = sa.table(
        "integration_bindings",
        sa.column("id", sa.Uuid()),
        sa.column("tenant_id", sa.Uuid()),
        sa.column("connection_id", sa.Uuid()),
        sa.column("binding_type", sa.String()),
        sa.column("config_json", sa.Text()),
    )
    existing = conn.execute(
        sa.select(bindings.c.connection_id, bindings.c.config_json).where(
            bindings.c.binding_type == "module"
        )
    ).fetchall()
    already: set[tuple[str, str]] = set()
    for connection_id, raw in existing:
        try:
            data = json.loads(raw or "{}")
        except json.JSONDecodeError:
            data = {}
        slug = str(data.get("module_slug") or "")
        already.add((str(connection_id), slug))

    rows = conn.execute(
        sa.select(
            connections.c.id,
            connections.c.tenant_id,
            connections.c.provider,
        ).where(connections.c.status == "active")
    ).fetchall()
    inserts = []
    for connection_id, tenant_id, provider in rows:
        slug = PROVIDER_MODULE.get(str(provider or ""))
        if not slug:
            continue
        if (str(connection_id), slug) in already:
            continue
        inserts.append(
            {
                "id": uuid.uuid4(),
                "tenant_id": tenant_id,
                "connection_id": connection_id,
                "binding_type": "module",
                "config_json": json.dumps({"module_slug": slug}),
            }
        )
    if inserts:
        op.bulk_insert(bindings, inserts)


def downgrade() -> None:
    bindings = sa.table(
        "integration_bindings",
        sa.column("binding_type", sa.String()),
    )
    op.execute(bindings.delete().where(bindings.c.binding_type == "module"))
