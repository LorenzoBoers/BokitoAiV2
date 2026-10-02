"""Layered AI handling: contact/conversation overrides, drop signals.ai_paused.

Revision ID: 055_ai_handling
Revises: 054_usage_ledger_region
"""

import sqlalchemy as sa
from alembic import op

from app.db.ai_handling_converge import map_pause_flags, map_settings

revision = "055_ai_handling"
down_revision = "054_usage_ledger_region"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    inspector = sa.inspect(conn)
    signal_cols = {col["name"] for col in inspector.get_columns("signals")}
    contact_cols = {col["name"] for col in inspector.get_columns("contacts")}
    if "ai_handling" not in signal_cols:
        op.add_column("signals", sa.Column("ai_handling", sa.String(), nullable=True))
    if "ai_handling_reason" not in signal_cols:
        op.add_column("signals", sa.Column("ai_handling_reason", sa.String(), nullable=True))
    if "ai_handling" not in contact_cols:
        op.add_column("contacts", sa.Column("ai_handling", sa.String(), nullable=True))

    map_pause_flags(conn)
    map_settings(conn)

    if "ai_paused" in signal_cols:
        op.drop_column("signals", "ai_paused")


def downgrade() -> None:
    op.add_column(
        "signals",
        sa.Column("ai_paused", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.execute("UPDATE signals SET ai_paused = true WHERE ai_handling = 'manual'")
    op.drop_column("signals", "ai_handling_reason")
    op.drop_column("signals", "ai_handling")
    op.drop_column("contacts", "ai_handling")
