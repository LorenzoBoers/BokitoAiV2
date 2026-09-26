"""Conversation follow-up date on signals (next look-at).

Revision ID: 046_signal_follow_up
Revises: 045_case_type_fields
"""

import sqlalchemy as sa
from alembic import op

revision = "046_signal_follow_up"
down_revision = "045_case_type_fields"
branch_labels = None
depends_on = None


def _columns(conn, table: str) -> set[str]:
    inspector = sa.inspect(conn)
    if table not in inspector.get_table_names():
        return set()
    return {column["name"] for column in inspector.get_columns(table)}


def _indexes(conn, table: str) -> set[str]:
    inspector = sa.inspect(conn)
    if table not in inspector.get_table_names():
        return set()
    return {index["name"] for index in inspector.get_indexes(table) if index.get("name")}


def upgrade() -> None:
    if "follow_up_at" not in _columns(op.get_bind(), "signals"):
        op.add_column("signals", sa.Column("follow_up_at", sa.DateTime(), nullable=True))
    if "ix_signals_follow_up_at" not in _indexes(op.get_bind(), "signals"):
        op.create_index("ix_signals_follow_up_at", "signals", ["follow_up_at"])
    if "follow_up_title" not in _columns(op.get_bind(), "signals"):
        op.add_column(
            "signals",
            sa.Column("follow_up_title", sa.String(), nullable=False, server_default=""),
        )


def downgrade() -> None:
    if "ix_signals_follow_up_at" in _indexes(op.get_bind(), "signals"):
        op.drop_index("ix_signals_follow_up_at", table_name="signals")
    existing = _columns(op.get_bind(), "signals")
    if "follow_up_title" in existing:
        op.drop_column("signals", "follow_up_title")
    if "follow_up_at" in existing:
        op.drop_column("signals", "follow_up_at")
