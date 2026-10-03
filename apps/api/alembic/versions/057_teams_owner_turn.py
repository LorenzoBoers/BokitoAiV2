"""Teams, conversation owner and turn, decision addressee, availability, handover codes.

Revision ID: 057_teams_owner_turn
Revises: 056_signal_contact_basis
"""

import json
import uuid
from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision = "057_teams_owner_turn"
down_revision = "056_signal_contact_basis"
branch_labels = None
depends_on = None


def _cols(inspector, table: str) -> set[str]:
    return {col["name"] for col in inspector.get_columns(table)}


def _add(table: str, existing: set[str], column: sa.Column) -> None:
    if column.name not in existing:
        op.add_column(table, column)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "teams" not in tables:
        op.create_table(
            "teams",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False, index=True),
            sa.Column("name", sa.String(), nullable=False),
            sa.Column("description", sa.String(), nullable=False, server_default=""),
            sa.Column("kind", sa.String(), nullable=False, server_default="custom", index=True),
            sa.Column("pickup", sa.String(), nullable=False, server_default="people"),
            sa.Column("pinned", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("last_pick", sa.String(), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )
    if "team_members" not in tables:
        op.create_table(
            "team_members",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False, index=True),
            sa.Column("team_id", sa.Uuid(), sa.ForeignKey("teams.id"), nullable=False, index=True),
            sa.Column("member_kind", sa.String(), nullable=False, server_default="user"),
            sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True, index=True),
            sa.Column("agent_id", sa.Uuid(), sa.ForeignKey("agents.id"), nullable=True, index=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
    if "handover_codes" not in tables:
        op.create_table(
            "handover_codes",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False, index=True),
            sa.Column("code", sa.String(), nullable=False, index=True),
            sa.Column("from_signal_id", sa.Uuid(), sa.ForeignKey("signals.id"), nullable=False, index=True),
            sa.Column("whatsapp_account_id", sa.Uuid(), sa.ForeignKey("channel_accounts.id"), nullable=True),
            sa.Column("to_signal_id", sa.Uuid(), sa.ForeignKey("signals.id"), nullable=True),
            sa.Column("language", sa.String(), nullable=False, server_default="en"),
            sa.Column("expires_at", sa.DateTime(), nullable=False, index=True),
            sa.Column("used_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )

    signal_cols = _cols(inspector, "signals")
    _add("signals", signal_cols, sa.Column("assignee_kind", sa.String(), nullable=False, server_default=""))
    _add("signals", signal_cols, sa.Column("assignee_team_id", sa.Uuid(), sa.ForeignKey("teams.id"), nullable=True))
    _add("signals", signal_cols, sa.Column("assigned_by_user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True))
    _add("signals", signal_cols, sa.Column("turn_kind", sa.String(), nullable=False, server_default=""))
    _add("signals", signal_cols, sa.Column("turn_user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True))
    _add("signals", signal_cols, sa.Column("turn_team_id", sa.Uuid(), sa.ForeignKey("teams.id"), nullable=True))
    _add("signals", signal_cols, sa.Column("turn_reason", sa.String(), nullable=False, server_default=""))
    for name in ("assignee_kind", "assignee_team_id", "turn_kind", "turn_user_id", "turn_team_id"):
        if name not in signal_cols:
            op.create_index(f"ix_signals_{name}", "signals", [name])

    decision_cols = _cols(inspector, "decision_requests")
    _add("decision_requests", decision_cols, sa.Column("addressee_kind", sa.String(), nullable=False, server_default=""))
    _add("decision_requests", decision_cols, sa.Column("addressee_user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True))
    _add("decision_requests", decision_cols, sa.Column("addressee_team_id", sa.Uuid(), sa.ForeignKey("teams.id"), nullable=True))
    _add("decision_requests", decision_cols, sa.Column("routed_by", sa.String(), nullable=False, server_default=""))
    _add("decision_requests", decision_cols, sa.Column("rule_id", sa.String(), nullable=False, server_default=""))
    _add(
        "decision_requests",
        decision_cols,
        sa.Column("resolved_by_user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
    )

    user_cols = _cols(inspector, "users")
    _add("users", user_cols, sa.Column("last_seen_at", sa.DateTime(), nullable=True))
    _add("users", user_cols, sa.Column("away", sa.Boolean(), nullable=False, server_default=sa.false()))
    _add("users", user_cols, sa.Column("away_until", sa.DateTime(), nullable=True))

    # System teams per workspace, then give every conversation an owner.
    now = datetime.utcnow()
    tenants = [row[0] for row in bind.execute(sa.text("SELECT id FROM tenants")).fetchall()]
    teams_t = sa.table(
        "teams",
        sa.column("id", sa.Uuid()),
        sa.column("tenant_id", sa.Uuid()),
        sa.column("name", sa.String()),
        sa.column("description", sa.String()),
        sa.column("kind", sa.String()),
        sa.column("pickup", sa.String()),
        sa.column("last_pick", sa.String()),
        sa.column("created_at", sa.DateTime()),
        sa.column("updated_at", sa.DateTime()),
    )
    for tenant_id in tenants:
        tid = tenant_id if isinstance(tenant_id, uuid.UUID) else uuid.UUID(str(tenant_id))
        existing = {
            row[0]
            for row in bind.execute(
                sa.text("SELECT kind FROM teams WHERE tenant_id = :t"), {"t": tid}
            ).fetchall()
        }
        rows = []
        if "people" not in existing:
            rows.append({"name": "All people", "kind": "people"})
        if "agents" not in existing:
            rows.append({"name": "All agents", "kind": "agents"})
        for row in rows:
            bind.execute(
                teams_t.insert().values(
                    id=uuid.uuid4(),
                    tenant_id=tid,
                    name=row["name"],
                    description="",
                    kind=row["kind"],
                    pickup="people",
                    last_pick="",
                    created_at=now,
                    updated_at=now,
                )
            )

    bind.execute(
        sa.text(
            "UPDATE signals SET assignee_kind = 'user' "
            "WHERE assigned_user_id IS NOT NULL AND assignee_kind = ''"
        )
    )
    bind.execute(
        sa.text(
            "UPDATE signals SET assignee_kind = 'agent' "
            "WHERE assignee_kind = '' AND agent_id IS NOT NULL "
            "AND channel IN ('internal', 'assistant')"
        )
    )
    bind.execute(
        sa.text(
            "UPDATE signals SET assignee_kind = 'team', assignee_team_id = "
            "(SELECT teams.id FROM teams WHERE teams.tenant_id = signals.tenant_id "
            "AND teams.kind = 'people' LIMIT 1) WHERE assignee_kind = ''"
        )
    )

    # Initial turn for open customer conversations (the ORM keeps it current afterwards).
    external = "('email','chat','widget','slack','whatsapp','webhook','integration','api')"
    owner_turn = (
        "turn_kind = CASE assignee_kind WHEN 'user' THEN 'user' WHEN 'agent' THEN 'agent' ELSE 'team' END, "
        "turn_user_id = CASE assignee_kind WHEN 'user' THEN assigned_user_id ELSE NULL END, "
        "turn_team_id = CASE assignee_kind WHEN 'team' THEN assignee_team_id ELSE NULL END"
    )
    bind.execute(
        sa.text(
            f"UPDATE signals SET turn_kind = 'customer' WHERE status = 'open' AND channel IN {external}"
        )
    )
    bind.execute(
        sa.text(
            f"UPDATE signals SET {owner_turn}, turn_reason = 'reply_needed' "
            f"WHERE status = 'open' AND channel IN {external} AND "
            "COALESCE((SELECT MAX(m.created_at) FROM signal_messages m WHERE m.signal_id = signals.id "
            "AND m.direction = 'inbound' AND m.kind = 'user_message'), '1970-01-01') >= "
            "COALESCE((SELECT MAX(m.created_at) FROM signal_messages m WHERE m.signal_id = signals.id "
            "AND m.direction = 'outbound' AND m.kind IN ('user_message', 'agent_message')), '1970-01-01')"
        )
    )
    bind.execute(
        sa.text(
            "UPDATE signals SET turn_kind = CASE WHEN assignee_kind = 'user' THEN 'user' ELSE 'team' END, "
            "turn_user_id = CASE WHEN assignee_kind = 'user' THEN assigned_user_id ELSE NULL END, "
            "turn_team_id = CASE WHEN assignee_kind = 'user' THEN NULL ELSE COALESCE(assignee_team_id, "
            "(SELECT teams.id FROM teams WHERE teams.tenant_id = signals.tenant_id "
            "AND teams.kind = 'people' LIMIT 1)) END, "
            "turn_reason = 'question' WHERE status = 'open' AND EXISTS (SELECT 1 FROM decision_requests d "
            "WHERE d.signal_id = signals.id AND d.status = 'awaiting_human' AND d.title <> 'No reply needed')"
        )
    )

    notification_cols = _cols(inspector, "notifications")
    _add("notifications", notification_cols, sa.Column("signal_id", sa.Uuid(), sa.ForeignKey("signals.id"), nullable=True))
    _add("notifications", notification_cols, sa.Column("tier", sa.Integer(), nullable=False, server_default="2"))
    if "signal_id" not in notification_cols:
        op.create_index("ix_notifications_signal_id", "notifications", ["signal_id"])
    if "tier" not in notification_cols:
        op.create_index("ix_notifications_tier", "notifications", ["tier"])

    # Channel visibility becomes one access list; the unused agent channel scope goes.
    accounts = bind.execute(sa.text("SELECT id, settings_json FROM channel_accounts")).fetchall()
    for account_id, settings_json in accounts:
        try:
            settings = json.loads(settings_json or "{}")
        except ValueError:
            continue
        if not isinstance(settings, dict) or "visibility" not in settings:
            continue
        visibility = settings.pop("visibility")
        if isinstance(visibility, dict) and visibility.get("mode") == "selected":
            entries = [
                {"kind": "user", "id": str(u), "level": "handle"}
                for u in visibility.get("user_ids") or []
                if u
            ]
            entries.append({"kind": "team", "id": "agents", "level": "handle"})
            settings["access"] = entries
        bind.execute(
            sa.text("UPDATE channel_accounts SET settings_json = :s WHERE id = :i"),
            {"s": json.dumps(settings), "i": account_id},
        )
    if "agent_scopes" in tables:
        bind.execute(sa.text("DELETE FROM agent_scopes WHERE resource_kind = 'channel'"))

    # One autonomy vocabulary: agent ceilings use the AI handling modes.
    bind.execute(sa.text("UPDATE agents SET autonomy_level = 'assisted' WHERE autonomy_level = 'approval'"))
    bind.execute(sa.text("UPDATE agents SET autonomy_level = 'autonomous' WHERE autonomy_level = 'auto'"))


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text("UPDATE agents SET autonomy_level = 'approval' WHERE autonomy_level = 'assisted'"))
    bind.execute(sa.text("UPDATE agents SET autonomy_level = 'auto' WHERE autonomy_level = 'autonomous'"))
    op.drop_index("ix_notifications_tier", table_name="notifications")
    op.drop_index("ix_notifications_signal_id", table_name="notifications")
    op.drop_column("notifications", "tier")
    op.drop_column("notifications", "signal_id")
    for name in ("away_until", "away", "last_seen_at"):
        op.drop_column("users", name)
    for name in (
        "resolved_by_user_id", "rule_id", "routed_by", "addressee_team_id", "addressee_user_id", "addressee_kind",
    ):
        op.drop_column("decision_requests", name)
    for name in ("assignee_kind", "assignee_team_id", "turn_kind", "turn_user_id", "turn_team_id"):
        op.drop_index(f"ix_signals_{name}", table_name="signals")
    for name in (
        "turn_reason",
        "turn_team_id",
        "turn_user_id",
        "turn_kind",
        "assigned_by_user_id",
        "assignee_team_id",
        "assignee_kind",
    ):
        op.drop_column("signals", name)
    op.drop_table("handover_codes")
    op.drop_table("team_members")
    op.drop_table("teams")
