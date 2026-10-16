"""Slim Signal ownership/turn/floor columns.

Revision ID: 103_signal_owner_slim
Revises: 102_drop_workstream_runs
Create Date: 2026-10-15

- assignee_id (polymorphic) replaces assigned_user_id + assignee_team_id
- turn_ref_id replaces turn_user_id + turn_team_id
- last_human_owner_json replaces last_human_owner_* triplet
- floor_json merges active_turn_json + handoff_session_json
- agent_id kept as handling pin
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "103_signal_owner_slim"
down_revision = "102_drop_workstream_runs"
branch_labels = None
depends_on = None


def _cols() -> set[str]:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "signals" not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns("signals")}


def _drop_col(column: str) -> None:
    cols = _cols()
    if column not in cols:
        return
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    for fk in inspector.get_foreign_keys("signals"):
        if column in (fk.get("constrained_columns") or []):
            name = fk.get("name")
            if name:
                op.drop_constraint(name, "signals", type_="foreignkey")
    for index in inspector.get_indexes("signals"):
        if column in (index.get("column_names") or []):
            name = index.get("name")
            if name:
                op.drop_index(name, table_name="signals")
    op.drop_column("signals", column)


def upgrade() -> None:
    cols = _cols()
    if "assignee_id" not in cols:
        op.add_column("signals", sa.Column("assignee_id", sa.Uuid(), nullable=True))
        op.create_index("ix_signals_assignee_id", "signals", ["assignee_id"])
    if "turn_ref_id" not in cols:
        op.add_column("signals", sa.Column("turn_ref_id", sa.Uuid(), nullable=True))
        op.create_index("ix_signals_turn_ref_id", "signals", ["turn_ref_id"])
    if "last_human_owner_json" not in cols:
        op.add_column(
            "signals",
            sa.Column("last_human_owner_json", sa.Text(), server_default="{}", nullable=False),
        )
    if "floor_json" not in cols:
        op.add_column(
            "signals",
            sa.Column("floor_json", sa.Text(), server_default="{}", nullable=False),
        )

    cols = _cols()
    # Backfill assignee_id
    if "assigned_user_id" in cols:
        op.execute(
            sa.text(
                """
                UPDATE signals
                SET assignee_id = assigned_user_id
                WHERE assignee_kind = 'user'
                  AND assigned_user_id IS NOT NULL
                  AND assignee_id IS NULL
                """
            )
        )
    if "assignee_team_id" in cols:
        op.execute(
            sa.text(
                """
                UPDATE signals
                SET assignee_id = assignee_team_id
                WHERE assignee_kind = 'team'
                  AND assignee_team_id IS NOT NULL
                  AND assignee_id IS NULL
                """
            )
        )
    if "agent_id" in cols:
        op.execute(
            sa.text(
                """
                UPDATE signals
                SET assignee_id = agent_id
                WHERE assignee_kind = 'agent'
                  AND agent_id IS NOT NULL
                  AND assignee_id IS NULL
                """
            )
        )

    # Backfill turn_ref_id
    if "turn_user_id" in cols:
        op.execute(
            sa.text(
                """
                UPDATE signals
                SET turn_ref_id = turn_user_id
                WHERE turn_kind = 'user'
                  AND turn_user_id IS NOT NULL
                  AND turn_ref_id IS NULL
                """
            )
        )
    if "turn_team_id" in cols:
        op.execute(
            sa.text(
                """
                UPDATE signals
                SET turn_ref_id = turn_team_id
                WHERE turn_kind = 'team'
                  AND turn_team_id IS NOT NULL
                  AND turn_ref_id IS NULL
                """
            )
        )

    # Backfill last_human_owner_json
    if "last_human_owner_kind" in cols:
        op.execute(
            sa.text(
                """
                UPDATE signals
                SET last_human_owner_json = CASE
                  WHEN last_human_owner_kind = 'user' AND last_human_owner_user_id IS NOT NULL
                    THEN '{"kind":"user","id":"' || CAST(last_human_owner_user_id AS VARCHAR) || '"}'
                  WHEN last_human_owner_kind = 'team' AND last_human_owner_team_id IS NOT NULL
                    THEN '{"kind":"team","id":"' || CAST(last_human_owner_team_id AS VARCHAR) || '"}'
                  ELSE '{}'
                END
                WHERE last_human_owner_json = '{}' OR last_human_owner_json IS NULL OR last_human_owner_json = ''
                """
            )
        )

    # Backfill floor_json from the two JSON columns
    if "active_turn_json" in cols and "handoff_session_json" in cols:
        op.execute(
            sa.text(
                """
                UPDATE signals
                SET floor_json = '{"active_turn":' ||
                    CASE WHEN active_turn_json IS NULL OR active_turn_json = '' THEN '{}'
                         ELSE active_turn_json END ||
                    ',"handoff_session":' ||
                    CASE WHEN handoff_session_json IS NULL OR handoff_session_json = '' THEN '{}'
                         ELSE handoff_session_json END ||
                    '}'
                WHERE floor_json = '{}' OR floor_json IS NULL OR floor_json = ''
                """
            )
        )

    for column in (
        "assigned_user_id",
        "assignee_team_id",
        "turn_user_id",
        "turn_team_id",
        "last_human_owner_kind",
        "last_human_owner_user_id",
        "last_human_owner_team_id",
        "active_turn_json",
        "handoff_session_json",
    ):
        _drop_col(column)


def downgrade() -> None:
    pass
