"""One open agent call per person.

Revision ID: 153_one_open_call
Revises: 152_flow_source

Ends extra ringing and live calls so the unique index can be created.
The newest live call is kept, otherwise the newest ring.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "153_one_open_call"
down_revision = "152_flow_source"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("agent_calls"):
        return
    op.execute(
        sa.text(
            """
            WITH ranked AS (
                SELECT id,
                       row_number() OVER (
                           PARTITION BY user_id
                           ORDER BY CASE WHEN status = 'live' THEN 0 ELSE 1 END,
                                    created_at DESC
                       ) AS n
                FROM agent_calls
                WHERE status IN ('ringing', 'live')
            )
            UPDATE agent_calls
            SET status = 'ended', ended_at = CURRENT_TIMESTAMP
            WHERE id IN (SELECT id FROM ranked WHERE n > 1)
            """
        )
    )
    indexes = {idx["name"] for idx in inspector.get_indexes("agent_calls")}
    if "uq_agent_calls_one_open_per_user" not in indexes:
        op.create_index(
            "uq_agent_calls_one_open_per_user",
            "agent_calls",
            ["user_id"],
            unique=True,
            postgresql_where=sa.text("status IN ('ringing', 'live')"),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("agent_calls"):
        return
    indexes = {idx["name"] for idx in inspector.get_indexes("agent_calls")}
    if "uq_agent_calls_one_open_per_user" in indexes:
        op.drop_index("uq_agent_calls_one_open_per_user", table_name="agent_calls")
