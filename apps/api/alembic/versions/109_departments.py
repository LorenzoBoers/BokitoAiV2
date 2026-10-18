"""Rename teams to departments and rewrite the group kind.

Revision ID: 109_departments
Revises: 108_retire_default_ws

One grouping noun. Tables, foreign keys and stored kind tokens move from
team to department. System rows (kind people / agents) stay as internal
everyone-grants. Member rows gain duty and position.
"""

from __future__ import annotations

import json

import sqlalchemy as sa
from alembic import op

revision = "109_departments"
down_revision = "108_retire_default_ws"
branch_labels = None
depends_on = None

_KIND_COLUMNS = (
    ("signals", "assignee_kind"),
    ("signals", "turn_kind"),
    ("signals", "source"),
    ("signal_participants", "kind"),
    ("contacts", "owner_kind"),
    ("triggers", "recipient_kind"),
    ("decision_requests", "addressee_kind"),
)


def _rewrite_kind(value):
    if isinstance(value, str):
        return "department" if value == "team" else value
    if isinstance(value, list):
        return [_rewrite_kind(item) for item in value]
    if isinstance(value, dict):
        return {key: _rewrite_kind(item) for key, item in value.items()}
    return value


def _rewrite_json_column(bind, table: str, column: str) -> None:
    inspector = sa.inspect(bind)
    if table not in set(inspector.get_table_names()):
        return
    names = {col["name"] for col in inspector.get_columns(table)}
    if column not in names:
        return
    rows = bind.execute(sa.text(f"SELECT id, {column} FROM {table}")).mappings()
    for row in rows:
        raw = row[column]
        if not raw or "team" not in str(raw):
            continue
        try:
            parsed = json.loads(raw)
        except (TypeError, json.JSONDecodeError):
            continue
        rewritten = _rewrite_kind(parsed)
        if rewritten == parsed:
            continue
        bind.execute(
            sa.text(f"UPDATE {table} SET {column} = :value WHERE id = :id"),
            {"value": json.dumps(rewritten), "id": row["id"]},
        )


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "teams" in tables and "departments" not in tables:
        op.rename_table("teams", "departments")
    if "team_members" in tables and "department_members" not in tables:
        op.rename_table("team_members", "department_members")

    inspector = sa.inspect(bind)
    if "department_members" in set(inspector.get_table_names()):
        cols = {col["name"] for col in inspector.get_columns("department_members")}
        if "team_id" in cols and "department_id" not in cols:
            op.alter_column("department_members", "team_id", new_column_name="department_id")
        cols = {col["name"] for col in sa.inspect(bind).get_columns("department_members")}
        if "duty" not in cols:
            op.add_column(
                "department_members",
                sa.Column("duty", sa.String(length=16), nullable=False, server_default="member"),
            )
        if "position" not in cols:
            op.add_column(
                "department_members",
                sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
            )

    renames = (
        ("contacts", "owner_team_id", "owner_department_id"),
        ("triggers", "recipient_team_id", "recipient_department_id"),
        ("decision_requests", "addressee_team_id", "addressee_department_id"),
    )
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    for table, old, new in renames:
        if table not in tables:
            continue
        cols = {col["name"] for col in inspector.get_columns(table)}
        if old in cols and new not in cols:
            op.alter_column(table, old, new_column_name=new)

    for table, column in _KIND_COLUMNS:
        if table not in tables:
            continue
        cols = {col["name"] for col in sa.inspect(bind).get_columns(table)}
        if column not in cols:
            continue
        op.execute(
            sa.text(
                f"UPDATE {table} SET {column} = 'department' WHERE {column} = 'team'"
            )
        )

    _rewrite_json_column(bind, "signals", "last_human_owner_json")
    _rewrite_json_column(bind, "signals", "floor_json")
    _rewrite_json_column(bind, "channel_accounts", "settings_json")
    _rewrite_json_column(bind, "integration_connections", "metadata_json")
    _rewrite_json_column(bind, "tenant_calendars", "access_json")
    _rewrite_json_column(bind, "workstreams", "stages_json")


def downgrade() -> None:
    pass
