"""Drop workstream_steps — playbooks are stages-only.

Revision ID: 076_drop_workstream_steps
Revises: 075_tickets_on_conversations
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "076_drop_workstream_steps"
down_revision = "075_tickets_on_conversations"
branch_labels = None
depends_on = None


def _drop_fk_if_exists(table: str, column: str) -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if table not in inspector.get_table_names():
        return
    for fk in inspector.get_foreign_keys(table):
        constrained = fk.get("constrained_columns") or []
        referred = fk.get("referred_table")
        if column in constrained and referred == "workstream_steps":
            name = fk.get("name")
            if name:
                op.drop_constraint(name, table, type_="foreignkey")


def upgrade() -> None:
    # Clear dangling references before dropping the table.
    for table, column in (
        ("workstream_runs", "current_step_id"),
        ("agent_runs", "step_id"),
        ("agent_tasks", "current_step_id"),
        ("agent_tasks", "step_id"),
        ("eval_checkpoints", "step_id"),
    ):
        bind = op.get_bind()
        inspector = sa.inspect(bind)
        if table not in inspector.get_table_names():
            continue
        cols = {c["name"] for c in inspector.get_columns(table)}
        if column not in cols:
            continue
        _drop_fk_if_exists(table, column)
        op.execute(sa.text(f"UPDATE {table} SET {column} = NULL WHERE {column} IS NOT NULL"))

    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "workstream_steps" in inspector.get_table_names():
        op.drop_table("workstream_steps")


def downgrade() -> None:
    # Steps are retired; no downgrade path.
    pass
