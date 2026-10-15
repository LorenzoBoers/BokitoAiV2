"""Conversation participants for multi-party and agent↔agent threads.

Revision ID: 096_signal_participants
Revises: 095_folder_named_tree
"""

from __future__ import annotations

import uuid
from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision = "096_signal_participants"
down_revision = "095_folder_named_tree"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("signal_participants"):
        op.create_table(
            "signal_participants",
            sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
            sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
            sa.Column("signal_id", sa.Uuid(), sa.ForeignKey("signals.id"), nullable=False),
            sa.Column("kind", sa.String(length=16), nullable=False),
            sa.Column("ref_id", sa.Uuid(), nullable=False),
            sa.Column("role", sa.String(length=16), nullable=False, server_default="member"),
            sa.Column(
                "joined_at",
                sa.DateTime(),
                nullable=False,
                server_default=sa.text("CURRENT_TIMESTAMP"),
            ),
            sa.Column("left_at", sa.DateTime(), nullable=True),
            sa.Column(
                "invited_by_kind", sa.String(length=16), nullable=False, server_default=""
            ),
            sa.Column("invited_by_id", sa.Uuid(), nullable=True),
            sa.Column(
                "joined_via", sa.String(length=32), nullable=False, server_default=""
            ),
            sa.UniqueConstraint(
                "tenant_id",
                "signal_id",
                "kind",
                "ref_id",
                name="uq_signal_participants_member",
            ),
        )
        op.create_index(
            "ix_signal_participants_tenant_id", "signal_participants", ["tenant_id"]
        )
        op.create_index(
            "ix_signal_participants_signal_id", "signal_participants", ["signal_id"]
        )
        op.create_index("ix_signal_participants_kind", "signal_participants", ["kind"])
        op.create_index(
            "ix_signal_participants_ref_id", "signal_participants", ["ref_id"]
        )
        op.create_index(
            "ix_signal_participants_signal", "signal_participants", ["signal_id"]
        )
        op.create_index(
            "ix_signal_participants_ref", "signal_participants", ["kind", "ref_id"]
        )

    signals = sa.table(
        "signals",
        sa.column("id", sa.Uuid()),
        sa.column("tenant_id", sa.Uuid()),
        sa.column("assigned_user_id", sa.Uuid()),
        sa.column("assignee_kind", sa.String()),
        sa.column("agent_id", sa.Uuid()),
        sa.column("assignee_team_id", sa.Uuid()),
        sa.column("contact_id", sa.Uuid()),
        sa.column("owner_user_id", sa.Uuid()),
        sa.column("created_at", sa.DateTime()),
    )
    parts = sa.table(
        "signal_participants",
        sa.column("id", sa.Uuid()),
        sa.column("tenant_id", sa.Uuid()),
        sa.column("signal_id", sa.Uuid()),
        sa.column("kind", sa.String()),
        sa.column("ref_id", sa.Uuid()),
        sa.column("role", sa.String()),
        sa.column("joined_at", sa.DateTime()),
        sa.column("left_at", sa.DateTime()),
        sa.column("invited_by_kind", sa.String()),
        sa.column("invited_by_id", sa.Uuid()),
        sa.column("joined_via", sa.String()),
    )

    existing = {
        (r.signal_id, r.kind, r.ref_id)
        for r in bind.execute(
            sa.select(parts.c.signal_id, parts.c.kind, parts.c.ref_id)
        ).fetchall()
    }
    rows = bind.execute(
        sa.select(
            signals.c.id,
            signals.c.tenant_id,
            signals.c.assigned_user_id,
            signals.c.assignee_kind,
            signals.c.agent_id,
            signals.c.assignee_team_id,
            signals.c.contact_id,
            signals.c.owner_user_id,
            signals.c.created_at,
        )
    ).fetchall()

    insert_rows: list[dict] = []

    def add(signal_id, tenant_id, kind, ref_id, role, joined_at) -> None:
        if ref_id is None:
            return
        key = (signal_id, kind, ref_id)
        if key in existing:
            return
        existing.add(key)
        insert_rows.append(
            {
                "id": uuid.uuid4(),
                "tenant_id": tenant_id,
                "signal_id": signal_id,
                "kind": kind,
                "ref_id": ref_id,
                "role": role,
                "joined_at": joined_at or datetime.utcnow(),
                "left_at": None,
                "invited_by_kind": "",
                "invited_by_id": None,
                "joined_via": "backfill",
            }
        )

    for row in rows:
        kind = (row.assignee_kind or "").strip()
        joined = row.created_at
        if row.assigned_user_id and kind in ("user", ""):
            add(row.id, row.tenant_id, "user", row.assigned_user_id, "owner", joined)
        if row.agent_id:
            add(
                row.id,
                row.tenant_id,
                "agent",
                row.agent_id,
                "owner" if kind == "agent" else "member",
                joined,
            )
        if row.assignee_team_id and kind == "team":
            add(row.id, row.tenant_id, "team", row.assignee_team_id, "owner", joined)
        if row.contact_id:
            add(row.id, row.tenant_id, "contact", row.contact_id, "member", joined)
        if row.owner_user_id:
            add(row.id, row.tenant_id, "user", row.owner_user_id, "member", joined)

    if insert_rows:
        op.bulk_insert(parts, insert_rows)


def downgrade() -> None:
    op.drop_table("signal_participants")
