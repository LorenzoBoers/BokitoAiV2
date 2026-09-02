"""Unify email routing into inbox_rules (Signals rules model).

Revision ID: 028_inbox_rules_routing
Revises: 027_signal_msg_external_idx
"""

import uuid
from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision = "028_inbox_rules_routing"
down_revision = "027_signal_msg_external_idx"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "inbox_rules",
        sa.Column("channel_account_id", sa.Uuid(), nullable=True),
    )
    op.add_column(
        "inbox_rules",
        sa.Column("priority", sa.Integer(), server_default="100", nullable=False),
    )
    op.add_column(
        "inbox_rules",
        sa.Column("assign_to_user_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "inbox_rules",
        sa.Column("labels_json", sa.Text(), server_default="[]", nullable=False),
    )
    op.add_column(
        "inbox_rules",
        sa.Column("legacy_routing_rule_id", sa.Uuid(), nullable=True),
    )
    op.create_index("ix_inbox_rules_channel_account_id", "inbox_rules", ["channel_account_id"])
    op.create_index(
        "ix_inbox_rules_legacy_routing_rule_id", "inbox_rules", ["legacy_routing_rule_id"]
    )

    conn = op.get_bind()
    routing = sa.table(
        "email_routing_rules",
        sa.column("id", sa.Uuid()),
        sa.column("tenant_id", sa.Uuid()),
        sa.column("channel_account_id", sa.Uuid()),
        sa.column("priority", sa.Integer()),
        sa.column("condition_type", sa.String()),
        sa.column("condition_value", sa.String()),
        sa.column("assign_to_user_id", sa.Integer()),
        sa.column("labels_json", sa.Text()),
        sa.column("is_active", sa.Boolean()),
        sa.column("created_at", sa.DateTime()),
        sa.column("updated_at", sa.DateTime()),
    )
    inbox = sa.table(
        "inbox_rules",
        sa.column("id", sa.Uuid()),
        sa.column("tenant_id", sa.Uuid()),
        sa.column("match_type", sa.String()),
        sa.column("match_value", sa.String()),
        sa.column("label", sa.String()),
        sa.column("action", sa.String()),
        sa.column("status", sa.String()),
        sa.column("source", sa.String()),
        sa.column("observations", sa.Integer()),
        sa.column("hit_count", sa.Integer()),
        sa.column("last_hit_at", sa.DateTime()),
        sa.column("created_by_user_id", sa.Uuid()),
        sa.column("channel_account_id", sa.Uuid()),
        sa.column("priority", sa.Integer()),
        sa.column("assign_to_user_id", sa.Integer()),
        sa.column("labels_json", sa.Text()),
        sa.column("legacy_routing_rule_id", sa.Uuid()),
        sa.column("created_at", sa.DateTime()),
        sa.column("updated_at", sa.DateTime()),
    )
    existing = {
        row[0]
        for row in conn.execute(
            sa.select(inbox.c.legacy_routing_rule_id).where(
                inbox.c.legacy_routing_rule_id.is_not(None)
            )
        ).all()
    }
    rows = conn.execute(sa.select(routing)).mappings().all()
    now = datetime.utcnow()
    for row in rows:
        rid = row["id"]
        if rid in existing:
            continue
        conn.execute(
            inbox.insert().values(
                id=uuid.uuid4(),
                tenant_id=row["tenant_id"],
                match_type=row["condition_type"] or "sender_domain",
                match_value=(row["condition_value"] or "").strip().lower(),
                label="",
                action="route",
                status="active" if row["is_active"] else "paused",
                source="routing",
                observations=0,
                hit_count=0,
                last_hit_at=None,
                created_by_user_id=None,
                channel_account_id=row["channel_account_id"],
                priority=int(row["priority"] or 100),
                assign_to_user_id=row["assign_to_user_id"],
                labels_json=row["labels_json"] or "[]",
                legacy_routing_rule_id=rid,
                created_at=row["created_at"] or now,
                updated_at=row["updated_at"] or now,
            )
        )


def downgrade() -> None:
    op.drop_index("ix_inbox_rules_legacy_routing_rule_id", table_name="inbox_rules")
    op.drop_index("ix_inbox_rules_channel_account_id", table_name="inbox_rules")
    op.drop_column("inbox_rules", "legacy_routing_rule_id")
    op.drop_column("inbox_rules", "labels_json")
    op.drop_column("inbox_rules", "assign_to_user_id")
    op.drop_column("inbox_rules", "priority")
    op.drop_column("inbox_rules", "channel_account_id")
