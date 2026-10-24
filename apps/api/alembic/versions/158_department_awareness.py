"""Awareness lives on the department; visibility is open or shielded.

- ``departments.settings_json.awareness`` gets the awareness block of the
  department's point of contact (the agent with duty primary) when the
  department has none yet. The orientation wake now reads the department.
- ``departments.visibility`` is checked to open | shielded on Postgres.

Revision ID: 158_department_awareness
Revises: 157_org_tree
"""

from __future__ import annotations

import json

import sqlalchemy as sa
from alembic import op

revision = "158_department_awareness"
down_revision = "157_org_tree"
branch_labels = None
depends_on = None


def _load(raw) -> dict:
    try:
        data = json.loads(raw or "{}")
    except (TypeError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT d.id, d.settings_json, a.settings_json FROM departments d "
            "JOIN department_members m ON m.department_id = d.id "
            "AND m.member_kind = 'agent' AND m.duty = 'primary' "
            "JOIN agents a ON a.id = m.agent_id "
            "WHERE d.deleted_at IS NULL"
        )
    ).all()
    for dept_id, dept_raw, agent_raw in rows:
        dept = _load(dept_raw)
        if isinstance(dept.get("awareness"), dict):
            continue
        block = _load(agent_raw).get("awareness")
        if not isinstance(block, dict):
            continue
        dept["awareness"] = block
        bind.execute(
            sa.text("UPDATE departments SET settings_json = :s WHERE id = :i"),
            {"s": json.dumps(dept), "i": dept_id},
        )
    if bind.dialect.name == "postgresql":
        bind.execute(sa.text("UPDATE departments SET visibility = 'open' WHERE visibility NOT IN ('open', 'shielded')"))
        op.create_check_constraint(
            "ck_departments_visibility", "departments", "visibility IN ('open', 'shielded')"
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.drop_constraint("ck_departments_visibility", "departments", type_="check")
