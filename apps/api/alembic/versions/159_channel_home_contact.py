"""A channel lands on a node; the node's point of contact picks up.

``channel_accounts.default_agent_id`` goes. When it was set and the home
node (``routing_department_id``, else the organization) has no explicit
point of contact, that agent becomes it and joins the crew.

Revision ID: 159_channel_home_contact
Revises: 158_department_awareness
"""

from __future__ import annotations

import uuid

import sqlalchemy as sa
from alembic import op

revision = "159_channel_home_contact"
down_revision = "158_department_awareness"
branch_labels = None
depends_on = None


def _root(bind, tenant_id):
    return bind.execute(
        sa.text(
            "SELECT id FROM departments WHERE tenant_id = :t AND parent_id IS NULL "
            "AND name = 'All' AND deleted_at IS NULL"
        ),
        {"t": tenant_id},
    ).scalar()


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT c.tenant_id, c.default_agent_id, c.routing_department_id FROM channel_accounts c "
            "JOIN agents a ON a.id = c.default_agent_id "
            "WHERE c.default_agent_id IS NOT NULL AND a.is_active = :yes "
            "ORDER BY c.created_at"
        ),
        {"yes": True},
    ).all()
    for tenant_id, agent_id, home_id in rows:
        home = home_id or _root(bind, tenant_id)
        if home is None:
            continue
        has_contact = bind.execute(
            sa.text(
                "SELECT 1 FROM department_members WHERE department_id = :d "
                "AND member_kind = 'agent' AND duty = 'primary'"
            ),
            {"d": home},
        ).first()
        if has_contact:
            continue
        seat = bind.execute(
            sa.text(
                "SELECT id FROM department_members WHERE department_id = :d "
                "AND member_kind = 'agent' AND agent_id = :a"
            ),
            {"d": home, "a": agent_id},
        ).scalar()
        if seat is not None:
            bind.execute(sa.text("UPDATE department_members SET duty = 'primary' WHERE id = :i"), {"i": seat})
            continue
        bind.execute(
            sa.text(
                "INSERT INTO department_members "
                "(id, tenant_id, department_id, member_kind, agent_id, duty, position, focus, created_at) "
                "VALUES (:i, :t, :d, 'agent', :a, 'primary', 0, '', CURRENT_TIMESTAMP)"
            ),
            {"i": str(uuid.uuid4()), "t": tenant_id, "d": home, "a": agent_id},
        )
    with op.batch_alter_table("channel_accounts") as batch:
        batch.drop_column("default_agent_id")


def downgrade() -> None:
    with op.batch_alter_table("channel_accounts") as batch:
        batch.add_column(sa.Column("default_agent_id", sa.Uuid(), nullable=True))
