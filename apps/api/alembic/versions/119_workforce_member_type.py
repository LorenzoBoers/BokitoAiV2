"""Workforce directory type enum value on agents.

Revision ID: 119_workforce_member_type
Revises: 118_model_origin

``agents.member_type`` is ``person`` or ``ai_agent``. Company agents are
``ai_agent``. People stay ``person`` on the overview and are not stored here.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "119_workforce_member_type"
down_revision = "118_model_origin"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "agents" not in inspector.get_table_names():
        return
    columns = {col["name"] for col in inspector.get_columns("agents")}
    if "member_type" in columns:
        return
    op.add_column(
        "agents",
        sa.Column(
            "member_type",
            sa.String(length=32),
            nullable=False,
            server_default="ai_agent",
        ),
    )
    op.create_check_constraint(
        "ck_agents_member_type",
        "agents",
        "member_type IN ('person', 'ai_agent')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_agents_member_type", "agents", type_="check")
    op.drop_column("agents", "member_type")
