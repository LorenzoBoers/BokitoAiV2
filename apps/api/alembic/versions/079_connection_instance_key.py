"""One active connection per vendor account: integration_connections.instance_key.

Revision ID: 079_connection_instance_key
Revises: 078_stage_checkups
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "079_connection_instance_key"
down_revision = "078_stage_checkups"
branch_labels = None
depends_on = None

_INDEX = "uq_integration_connection_instance"
_WHERE = sa.text("instance_key <> '' AND status = 'active'")


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "integration_connections" not in inspector.get_table_names():
        return
    existing = {c["name"] for c in inspector.get_columns("integration_connections")}
    if "instance_key" not in existing:
        with op.batch_alter_table("integration_connections") as batch:
            batch.add_column(
                sa.Column("instance_key", sa.String(), nullable=False, server_default="")
            )
    indexes = {i["name"] for i in inspector.get_indexes("integration_connections")}
    if _INDEX not in indexes:
        op.create_index(
            _INDEX,
            "integration_connections",
            ["tenant_id", "provider", "instance_key"],
            unique=True,
            postgresql_where=_WHERE,
            sqlite_where=_WHERE,
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "integration_connections" not in inspector.get_table_names():
        return
    indexes = {i["name"] for i in inspector.get_indexes("integration_connections")}
    if _INDEX in indexes:
        op.drop_index(_INDEX, table_name="integration_connections")
    existing = {c["name"] for c in inspector.get_columns("integration_connections")}
    if "instance_key" in existing:
        with op.batch_alter_table("integration_connections") as batch:
            batch.drop_column("instance_key")
