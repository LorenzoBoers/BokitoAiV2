"""Tickets move through workstream stages; one category per conversation.

- ``workstreams.stages_json``, ``workstream_steps.stage_key``, ``cases.stage_key``
- Keeps one case per conversation (active first, then newest) and adds
  ``uq_cases_signal``
- Drops ``case_types.follow_up_mode``: an enabled workstream binding now makes
  a category a ticket; without one it only labels the conversation

Revision ID: 071_ticket_stages
Revises: 070_drop_agent_audience
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "071_ticket_stages"
down_revision = "070_drop_agent_audience"
branch_labels = None
depends_on = None


def _columns(inspector, table: str) -> set[str]:
    return {c["name"] for c in inspector.get_columns(table)}


_DUPLICATE_CASES = """
SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
        PARTITION BY signal_id
        ORDER BY CASE
            WHEN status IN ('open', 'waiting') THEN 0
            WHEN status = 'proposed' THEN 1
            ELSE 2
        END, created_at DESC
    ) AS rn
    FROM cases
) ranked WHERE rn > 1
"""


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "workstreams" in tables and "stages_json" not in _columns(inspector, "workstreams"):
        op.add_column(
            "workstreams",
            sa.Column("stages_json", sa.String(), nullable=False, server_default="[]"),
        )
    if "workstream_steps" in tables and "stage_key" not in _columns(inspector, "workstream_steps"):
        op.add_column(
            "workstream_steps",
            sa.Column("stage_key", sa.String(), nullable=False, server_default=""),
        )
    if "cases" in tables:
        if "stage_key" not in _columns(inspector, "cases"):
            op.add_column(
                "cases",
                sa.Column("stage_key", sa.String(), nullable=False, server_default=""),
            )
        if "work_jobs" in tables and "case_id" in _columns(inspector, "work_jobs"):
            op.execute(f"UPDATE work_jobs SET case_id = NULL WHERE case_id IN ({_DUPLICATE_CASES})")
        op.execute(f"DELETE FROM cases WHERE id IN ({_DUPLICATE_CASES})")
        uniques = {u["name"] for u in inspector.get_unique_constraints("cases")}
        if "uq_cases_signal" not in uniques:
            with op.batch_alter_table("cases") as batch:
                batch.create_unique_constraint("uq_cases_signal", ["signal_id"])
    if "case_types" in tables and "follow_up_mode" in _columns(inspector, "case_types"):
        with op.batch_alter_table("case_types") as batch:
            batch.drop_column("follow_up_mode")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "case_types" in tables and "follow_up_mode" not in _columns(inspector, "case_types"):
        op.add_column(
            "case_types",
            sa.Column("follow_up_mode", sa.String(), nullable=False, server_default="track"),
        )
    if "cases" in tables:
        uniques = {u["name"] for u in inspector.get_unique_constraints("cases")}
        with op.batch_alter_table("cases") as batch:
            if "uq_cases_signal" in uniques:
                batch.drop_constraint("uq_cases_signal", type_="unique")
            if "stage_key" in _columns(inspector, "cases"):
                batch.drop_column("stage_key")
    if "workstream_steps" in tables and "stage_key" in _columns(inspector, "workstream_steps"):
        op.drop_column("workstream_steps", "stage_key")
    if "workstreams" in tables and "stages_json" in _columns(inspector, "workstreams"):
        op.drop_column("workstreams", "stages_json")
