"""Drop the legacy email routing table and the case follow-up task flag.

`InboxRule` (action=route) is the only inbound matcher, so `email_routing_rules`
and the `inbox_rules.legacy_routing_rule_id` mirror column are gone. Filing a
signal no longer opens an Agenda task, so `case_types.follow_up_task` is gone
as well.

Revision ID: 042_retire_legacy_routing
Revises: 041_case_type_default_project
"""

import sqlalchemy as sa
from alembic import op

revision = "042_retire_legacy_routing"
down_revision = "041_case_type_default_project"
branch_labels = None
depends_on = None


def _tables(conn) -> set[str]:
    return set(sa.inspect(conn).get_table_names())


def _columns(conn, table: str) -> set[str]:
    inspector = sa.inspect(conn)
    if table not in inspector.get_table_names():
        return set()
    return {col["name"] for col in inspector.get_columns(table)}


def upgrade() -> None:
    conn = op.get_bind()

    if "legacy_routing_rule_id" in _columns(conn, "inbox_rules"):
        # SQLite drops the index with the column; Postgres needs it named.
        if conn.dialect.name != "sqlite":
            op.drop_index(
                "ix_inbox_rules_legacy_routing_rule_id", table_name="inbox_rules"
            )
        op.drop_column("inbox_rules", "legacy_routing_rule_id")

    if "email_routing_rules" in _tables(conn):
        op.drop_table("email_routing_rules")

    if "follow_up_task" in _columns(conn, "case_types"):
        op.drop_column("case_types", "follow_up_task")


def downgrade() -> None:
    conn = op.get_bind()

    if "follow_up_task" not in _columns(conn, "case_types"):
        op.add_column(
            "case_types",
            sa.Column(
                "follow_up_task", sa.Boolean(), nullable=False, server_default=sa.false()
            ),
        )

    if "email_routing_rules" not in _tables(conn):
        op.create_table(
            "email_routing_rules",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), index=True),
            sa.Column(
                "channel_account_id",
                sa.Uuid(),
                sa.ForeignKey("channel_accounts.id"),
                index=True,
            ),
            sa.Column("priority", sa.Integer(), nullable=False, server_default="100"),
            sa.Column("condition_type", sa.String(), nullable=False),
            sa.Column("condition_value", sa.String(), nullable=False),
            sa.Column("assign_to_user_id", sa.Integer(), nullable=True),
            sa.Column("labels_json", sa.String(), nullable=False, server_default="[]"),
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )

    if "legacy_routing_rule_id" not in _columns(conn, "inbox_rules"):
        op.add_column(
            "inbox_rules", sa.Column("legacy_routing_rule_id", sa.Uuid(), nullable=True)
        )
        op.create_index(
            "ix_inbox_rules_legacy_routing_rule_id",
            "inbox_rules",
            ["legacy_routing_rule_id"],
        )
