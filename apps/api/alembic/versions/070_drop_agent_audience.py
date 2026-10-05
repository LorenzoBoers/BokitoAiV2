"""Drop agents.audience — operator shape no longer uses customers/partners/internal.

Revision ID: 070_drop_agent_audience
Revises: 069_agent_status_working
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "070_drop_agent_audience"
down_revision = "069_agent_status_working"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "agents" not in set(inspector.get_table_names()):
        return
    cols = {c["name"] for c in inspector.get_columns("agents")}
    if "audience" in cols:
        op.drop_column("agents", "audience")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "agents" not in set(inspector.get_table_names()):
        return
    cols = {c["name"] for c in inspector.get_columns("agents")}
    if "audience" not in cols:
        op.add_column(
            "agents",
            sa.Column("audience", sa.String(), nullable=False, server_default="internal"),
        )
