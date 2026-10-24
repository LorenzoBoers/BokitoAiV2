"""Organization tree: crew focus, department visibility, lead becomes the root's point of contact.

- ``department_members.focus``: what a member does in that department.
- ``departments.visibility``: open | shielded.
- Pickup ``agent_first`` becomes ``people``: the point of contact picks up.
- The workspace lead (``agents.is_lead``) becomes the point of contact of the
  root (an agent row with duty primary), then the flag column is dropped.
- The root keeps only its point of contact, its accountable person and agents
  that sit nowhere else. People are on the root implicitly.

Revision ID: 157_org_tree
Revises: 156_voice_notes
"""

from __future__ import annotations

import uuid
from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision = "157_org_tree"
down_revision = "156_voice_notes"
branch_labels = None
depends_on = None


def _columns(bind, table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(bind).get_columns(table)}


def _pick_lead(bind, tenant_id, has_flag: bool):
    base = (
        "SELECT id FROM agents WHERE tenant_id = :t AND kind = 'company' "
        "AND is_active = :yes AND acts_for_user = :no"
    )
    params = {"t": tenant_id, "yes": True, "no": False}
    if has_flag:
        row = bind.execute(
            sa.text(base + " AND is_lead = :yes ORDER BY created_at LIMIT 1"), params
        ).first()
        if row:
            return row[0]
    row = bind.execute(
        sa.text(base + " AND role = 'assistant' ORDER BY created_at LIMIT 1"), params
    ).first()
    if row:
        return row[0]
    row = bind.execute(sa.text(base + " ORDER BY created_at LIMIT 1"), params).first()
    return row[0] if row else None


def upgrade() -> None:
    bind = op.get_bind()
    if "focus" not in _columns(bind, "department_members"):
        op.add_column(
            "department_members",
            sa.Column("focus", sa.String(length=80), nullable=False, server_default=""),
        )
    if "visibility" not in _columns(bind, "departments"):
        op.add_column(
            "departments",
            sa.Column("visibility", sa.String(length=16), nullable=False, server_default="open"),
        )

    # The point of contact picks up when a department is addressed; agent_first is gone.
    bind.execute(sa.text("UPDATE departments SET pickup = 'people' WHERE pickup = 'agent_first'"))

    has_flag = "is_lead" in _columns(bind, "agents")
    roots = bind.execute(
        sa.text(
            "SELECT id, tenant_id FROM departments "
            "WHERE parent_id IS NULL AND name = 'All' AND deleted_at IS NULL"
        )
    ).all()
    for root_id, tenant_id in roots:
        lead_id = _pick_lead(bind, tenant_id, has_flag)
        if lead_id is not None:
            bind.execute(
                sa.text(
                    "UPDATE department_members SET duty = 'member' WHERE department_id = :r "
                    "AND member_kind = 'agent' AND duty = 'primary' AND agent_id <> :a"
                ),
                {"r": root_id, "a": lead_id},
            )
            seated = bind.execute(
                sa.text(
                    "SELECT id FROM department_members WHERE department_id = :r "
                    "AND member_kind = 'agent' AND agent_id = :a"
                ),
                {"r": root_id, "a": lead_id},
            ).first()
            if seated:
                bind.execute(
                    sa.text("UPDATE department_members SET duty = 'primary' WHERE id = :i"),
                    {"i": seated[0]},
                )
            else:
                bind.execute(
                    sa.text(
                        "INSERT INTO department_members "
                        "(id, tenant_id, department_id, member_kind, agent_id, duty, position, focus, created_at) "
                        "VALUES (:i, :t, :r, 'agent', :a, 'primary', 0, '', :now)"
                    ),
                    {"i": uuid.uuid4(), "t": tenant_id, "r": root_id, "a": lead_id, "now": datetime.utcnow()},
                )
        # Agents that also sit in a living department leave the root; they inherit it.
        bind.execute(
            sa.text(
                "DELETE FROM department_members WHERE department_id = :r AND member_kind = 'agent' "
                "AND duty <> 'primary' AND agent_id IN ("
                "  SELECT m.agent_id FROM department_members m JOIN departments d ON d.id = m.department_id "
                "  WHERE m.member_kind = 'agent' AND m.department_id <> :r AND d.deleted_at IS NULL"
                ")"
            ),
            {"r": root_id},
        )
        # People are on the root implicitly; only the accountable person keeps a row.
        bind.execute(
            sa.text(
                "DELETE FROM department_members WHERE department_id = :r "
                "AND member_kind = 'user' AND duty <> 'primary'"
            ),
            {"r": root_id},
        )

    if has_flag:
        for index in sa.inspect(bind).get_indexes("agents"):
            if index.get("column_names") == ["is_lead"]:
                op.drop_index(index["name"], table_name="agents")
        op.drop_column("agents", "is_lead")


def downgrade() -> None:
    bind = op.get_bind()
    if "is_lead" not in _columns(bind, "agents"):
        op.add_column(
            "agents", sa.Column("is_lead", sa.Boolean(), nullable=False, server_default=sa.false())
        )
        op.create_index("ix_agents_is_lead", "agents", ["is_lead"])
        bind.execute(
            sa.text(
                "UPDATE agents SET is_lead = :yes WHERE id IN ("
                "  SELECT m.agent_id FROM department_members m JOIN departments d ON d.id = m.department_id "
                "  WHERE d.parent_id IS NULL AND d.name = 'All' AND m.member_kind = 'agent' AND m.duty = 'primary'"
                ")"
            ),
            {"yes": True},
        )
    if "visibility" in _columns(bind, "departments"):
        op.drop_column("departments", "visibility")
    if "focus" in _columns(bind, "department_members"):
        op.drop_column("department_members", "focus")
