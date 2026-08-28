"""Explicit channels: drop unused auto relay mailboxes, add a widget row.

Bokito email addresses are no longer provisioned on signup, so relay rows that
nobody ever used are removed. A relay that carries history (threads, messages,
or routing rules) stays: the address keeps resolving for inbound mail.

Every tenant gains one `channel="widget"` row so the website chat is a channel
with state and an off switch instead of tenant settings only.

Revision ID: 017_channel_registry
Revises: 016_project_work
"""

import uuid
from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision = "017_channel_registry"
down_revision = "016_project_work"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("channel_accounts"):
        return

    tables = set(inspector.get_table_names())

    # Auto-provisioned relays that never carried a conversation.
    conditions = ["channel = 'email'", "provider = 'bokito'"]
    if "signals" in tables:
        conditions.append(
            "id NOT IN (SELECT channel_account_id FROM signals "
            "WHERE channel_account_id IS NOT NULL)"
        )
    if "email_routing_rules" in tables:
        conditions.append(
            "id NOT IN (SELECT channel_account_id FROM email_routing_rules "
            "WHERE channel_account_id IS NOT NULL)"
        )
    if "channel_bindings" in tables:
        conditions.append(
            "id NOT IN (SELECT channel_account_id FROM channel_bindings "
            "WHERE channel_account_id IS NOT NULL)"
        )
    bind.execute(
        sa.text(f"DELETE FROM channel_accounts WHERE {' AND '.join(conditions)}")
    )

    # One website-chat row per tenant.
    now = datetime.utcnow()
    tenants = bind.execute(
        sa.text(
            "SELECT id, slug FROM tenants WHERE id NOT IN "
            "(SELECT tenant_id FROM channel_accounts WHERE channel = 'widget')"
        )
    ).fetchall()
    for row in tenants:
        bind.execute(
            sa.text(
                "INSERT INTO channel_accounts "
                "(id, tenant_id, channel, provider, address, display_name, "
                "is_enabled, sync_cursor, credentials_json, settings_json, created_at) "
                "VALUES (:id, :tenant_id, 'widget', 'widget', :address, "
                "'Website chat', :is_enabled, '', '{}', '{}', :created_at)"
            ),
            {
                "id": str(uuid.uuid4()),
                "tenant_id": str(row.id),
                "address": row.slug or "",
                "is_enabled": True,
                "created_at": now,
            },
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("channel_accounts"):
        return
    # Deleted relay rows are not restorable; drop the widget rows we added.
    bind.execute(sa.text("DELETE FROM channel_accounts WHERE channel = 'widget'"))
