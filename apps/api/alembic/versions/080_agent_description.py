"""Short operator-facing agent description (role blurb).

Revision ID: 080_agent_description
Revises: 079_connection_instance_key
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "080_agent_description"
down_revision = "079_connection_instance_key"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "agents" not in inspector.get_table_names():
        return
    existing = {c["name"] for c in inspector.get_columns("agents")}
    if "description" in existing:
        return
    with op.batch_alter_table("agents") as batch:
        batch.add_column(sa.Column("description", sa.String(), nullable=False, server_default=""))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "agents" not in inspector.get_table_names():
        return
    existing = {c["name"] for c in inspector.get_columns("agents")}
    if "description" not in existing:
        return
    with op.batch_alter_table("agents") as batch:
        batch.drop_column("description")
