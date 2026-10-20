"""Agent asks: a question one agent puts to another in a conversation.

Revision ID: 130_agent_asks
Revises: 129_agent_turns
"""

from __future__ import annotations

import json

import sqlalchemy as sa
from alembic import op

revision = "130_agent_asks"
down_revision = "129_agent_turns"
branch_labels = None
depends_on = None


def _swap_passport_tools(bind) -> None:
    """request_participant_turn became ask_agent + handoff_to."""
    rows = bind.execute(
        sa.text("SELECT id, tools_json FROM agents WHERE tools_json LIKE '%request_participant_turn%'")
    ).fetchall()
    for agent_id, raw in rows:
        try:
            names = json.loads(raw or "[]")
        except (TypeError, ValueError):
            continue
        if not isinstance(names, list):
            continue
        out: list[str] = []
        for name in names:
            for swapped in (("ask_agent", "handoff_to") if name == "request_participant_turn" else (name,)):
                if swapped not in out:
                    out.append(swapped)
        bind.execute(
            sa.text("UPDATE agents SET tools_json = :tools WHERE id = :id"),
            {"tools": json.dumps(out), "id": agent_id},
        )


def upgrade() -> None:
    bind = op.get_bind()
    tables = sa.inspect(bind).get_table_names()
    if "agents" in tables:
        _swap_passport_tools(bind)
    if "agent_asks" in tables:
        return
    op.create_table(
        "agent_asks",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("signal_id", sa.Uuid(), sa.ForeignKey("signals.id"), nullable=False),
        sa.Column("from_agent_id", sa.Uuid(), sa.ForeignKey("agents.id"), nullable=False),
        sa.Column("to_agent_id", sa.Uuid(), sa.ForeignKey("agents.id"), nullable=False),
        sa.Column("question", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(), nullable=False, server_default="open"),
        sa.Column("answer_text", sa.Text(), nullable=False, server_default=""),
        sa.Column("answer_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("episode_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("answered_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_agent_asks_tenant_id", "agent_asks", ["tenant_id"])
    op.create_index("ix_agent_asks_signal_id", "agent_asks", ["signal_id"])
    op.create_index("ix_agent_asks_status", "agent_asks", ["status"])


def downgrade() -> None:
    bind = op.get_bind()
    if "agent_asks" in sa.inspect(bind).get_table_names():
        op.drop_table("agent_asks")
