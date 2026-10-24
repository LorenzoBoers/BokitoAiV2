"""Module tools follow the department; the module roster goes.

Every agent on a module roster that does not sit in that module's department
joins it as a member. Then ``module_agents`` is dropped.

Revision ID: 160_module_tools_by_department
Revises: 159_channel_home_contact
"""

from __future__ import annotations

import uuid

import sqlalchemy as sa
from alembic import op

revision = "160_module_tools_by_department"
down_revision = "159_channel_home_contact"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if "module_agents" not in sa.inspect(bind).get_table_names():
        return
    rows = bind.execute(
        sa.text(
            "SELECT m.tenant_id, m.agent_id, d.id FROM module_agents m "
            "JOIN departments d ON d.tenant_id = m.tenant_id AND d.origin_module_slug = m.module_slug "
            "AND d.deleted_at IS NULL "
            "JOIN agents a ON a.id = m.agent_id "
            "WHERE a.is_active = :yes ORDER BY m.created_at"
        ),
        {"yes": True},
    ).all()
    for tenant_id, agent_id, department_id in rows:
        seated = bind.execute(
            sa.text(
                "SELECT 1 FROM department_members WHERE department_id = :d "
                "AND member_kind = 'agent' AND agent_id = :a"
            ),
            {"d": department_id, "a": agent_id},
        ).first()
        if seated:
            continue
        position = bind.execute(
            sa.text("SELECT COUNT(*) FROM department_members WHERE department_id = :d"),
            {"d": department_id},
        ).scalar() or 0
        bind.execute(
            sa.text(
                "INSERT INTO department_members "
                "(id, tenant_id, department_id, member_kind, agent_id, duty, position, focus, created_at) "
                "VALUES (:i, :t, :d, 'agent', :a, 'member', :p, '', CURRENT_TIMESTAMP)"
            ),
            {"i": str(uuid.uuid4()), "t": tenant_id, "d": department_id, "a": agent_id, "p": int(position)},
        )
    op.drop_table("module_agents")


def downgrade() -> None:
    op.create_table(
        "module_agents",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False, index=True),
        sa.Column("module_slug", sa.String(64), nullable=False, index=True),
        sa.Column("agent_id", sa.Uuid(), sa.ForeignKey("agents.id"), nullable=False, index=True),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("company_ids_json", sa.String(), nullable=False, server_default=""),
        sa.Column("can_write", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("tenant_id", "module_slug", "agent_id", name="uq_module_agent"),
    )
