"""Agent definition, compaction checkpoints, subagents, stop reason, auto-review.

- ``agents``: definition fields (denied tools, prompt mode, capability mode,
  skills, completion requirement, MCP inheritance).
- ``agent_runs.stop_reason``: why a turn ended.
- ``decision_requests.auto_review_json``: the auto-reviewer's verdict.
- ``signal_compactions``: one row per history compaction.
- ``subagent_messages``: follow-ups to running subagents.
- Passports that listed ``delegate_to_agent`` now list ``spawn_subagent``.

Revision ID: 132_agent_definition
Revises: 131_thread_snooze
"""

from __future__ import annotations

import json

import sqlalchemy as sa
from alembic import op

revision = "132_agent_definition"
down_revision = "131_thread_snooze"
branch_labels = None
depends_on = None

_AGENT_COLUMNS = (
    ("disallowed_tools_json", sa.Text(), "[]"),
    ("prompt_mode", sa.String(), "extend"),
    ("capability_mode", sa.String(), "all"),
    ("skills_json", sa.Text(), "[]"),
    ("completion_requirement_json", sa.Text(), "{}"),
    ("mcp_inheritance_json", sa.Text(), "{}"),
)
_SUBAGENT_TOOLS = ("spawn_subagent", "get_subagent_output", "kill_subagent", "send_subagent_message")


def _columns(bind, table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(bind).get_columns(table)}


def _swap_passport_tools(bind) -> None:
    rows = bind.execute(
        sa.text("SELECT id, tools_json FROM agents WHERE tools_json LIKE '%delegate_to_agent%'")
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
            for swapped in (_SUBAGENT_TOOLS if name == "delegate_to_agent" else (name,)):
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
        present = _columns(bind, "agents")
        for name, type_, default in _AGENT_COLUMNS:
            if name not in present:
                op.add_column("agents", sa.Column(name, type_, nullable=False, server_default=default))
        _swap_passport_tools(bind)
    if "agent_runs" in tables and "stop_reason" not in _columns(bind, "agent_runs"):
        op.add_column("agent_runs", sa.Column("stop_reason", sa.String(), nullable=False, server_default=""))
    if "decision_requests" in tables and "auto_review_json" not in _columns(bind, "decision_requests"):
        op.add_column(
            "decision_requests",
            sa.Column("auto_review_json", sa.Text(), nullable=False, server_default="{}"),
        )
    if "signal_compactions" not in tables:
        op.create_table(
            "signal_compactions",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
            sa.Column("signal_id", sa.Uuid(), sa.ForeignKey("signals.id"), nullable=False),
            sa.Column("from_index", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("to_index", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("summary", sa.Text(), nullable=False, server_default=""),
            sa.Column("trigger", sa.String(), nullable=False, server_default="auto"),
            sa.Column("tokens_before", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("context_window", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_signal_compactions_tenant_id", "signal_compactions", ["tenant_id"])
        op.create_index("ix_signal_compactions_signal_id", "signal_compactions", ["signal_id"])
    if "subagent_messages" not in tables:
        op.create_table(
            "subagent_messages",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
            sa.Column("target_run_id", sa.Uuid(), nullable=False),
            sa.Column("sender_run_id", sa.Uuid(), nullable=True),
            sa.Column("body", sa.Text(), nullable=False, server_default=""),
            sa.Column("delivery", sa.String(), nullable=False, server_default="steer"),
            sa.Column("status", sa.String(), nullable=False, server_default="pending"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("delivered_at", sa.DateTime(), nullable=True),
        )
        op.create_index("ix_subagent_messages_tenant_id", "subagent_messages", ["tenant_id"])
        op.create_index("ix_subagent_messages_target_run_id", "subagent_messages", ["target_run_id"])
        op.create_index("ix_subagent_messages_sender_run_id", "subagent_messages", ["sender_run_id"])
        op.create_index("ix_subagent_messages_status", "subagent_messages", ["status"])


def downgrade() -> None:
    bind = op.get_bind()
    tables = sa.inspect(bind).get_table_names()
    for table in ("subagent_messages", "signal_compactions"):
        if table in tables:
            op.drop_table(table)
    if "decision_requests" in tables and "auto_review_json" in _columns(bind, "decision_requests"):
        op.drop_column("decision_requests", "auto_review_json")
    if "agent_runs" in tables and "stop_reason" in _columns(bind, "agent_runs"):
        op.drop_column("agent_runs", "stop_reason")
    if "agents" in tables:
        present = _columns(bind, "agents")
        for name, _type, _default in _AGENT_COLUMNS:
            if name in present:
                op.drop_column("agents", name)
