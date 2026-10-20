"""Per-thread message order.

Revision ID: 128_message_seq
Revises: 127_flow_destination

``signal_messages.seq`` numbers every message in its thread; ``signals.last_seq``
holds the highest number handed out. Existing rows are numbered in the order
the timeline showed them (received_at, then created_at, then id).
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "128_message_seq"
down_revision = "127_flow_destination"
branch_labels = None
depends_on = None


def _columns(bind, table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(bind).get_columns(table)}


def _indexes(bind, table: str) -> set[str]:
    return {i["name"] for i in sa.inspect(bind).get_indexes(table)}


def upgrade() -> None:
    bind = op.get_bind()
    if "last_seq" not in _columns(bind, "signals"):
        op.add_column(
            "signals",
            sa.Column("last_seq", sa.Integer(), nullable=False, server_default="0"),
        )
    if "seq" not in _columns(bind, "signal_messages"):
        op.add_column("signal_messages", sa.Column("seq", sa.Integer(), nullable=True))
        bind.execute(
            sa.text(
                "UPDATE signal_messages AS m SET seq = ranked.n FROM ("
                "SELECT id, ROW_NUMBER() OVER (PARTITION BY signal_id "
                "ORDER BY COALESCE(received_at, created_at), created_at, id) AS n "
                "FROM signal_messages) AS ranked WHERE ranked.id = m.id"
            )
        )
        bind.execute(
            sa.text(
                "UPDATE signals AS s SET last_seq = mx.top FROM ("
                "SELECT signal_id, MAX(seq) AS top FROM signal_messages GROUP BY signal_id"
                ") AS mx WHERE mx.signal_id = s.id"
            )
        )
    if "ux_signal_messages_signal_seq" not in _indexes(bind, "signal_messages"):
        op.create_index(
            "ux_signal_messages_signal_seq",
            "signal_messages",
            ["signal_id", "seq"],
            unique=True,
        )


def downgrade() -> None:
    bind = op.get_bind()
    if "ux_signal_messages_signal_seq" in _indexes(bind, "signal_messages"):
        op.drop_index("ux_signal_messages_signal_seq", table_name="signal_messages")
    if "seq" in _columns(bind, "signal_messages"):
        op.drop_column("signal_messages", "seq")
    if "last_seq" in _columns(bind, "signals"):
        op.drop_column("signals", "last_seq")
