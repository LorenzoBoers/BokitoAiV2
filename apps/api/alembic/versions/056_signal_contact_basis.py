"""Signal.contact_basis: how a thread is linked to its person.

Revision ID: 056_signal_contact_basis
Revises: 055_ai_handling
"""

import sqlalchemy as sa
from alembic import op

revision = "056_signal_contact_basis"
down_revision = "055_ai_handling"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    signal_cols = {col["name"] for col in inspector.get_columns("signals")}
    if "contact_basis" not in signal_cols:
        op.add_column(
            "signals",
            sa.Column("contact_basis", sa.String(), nullable=False, server_default=""),
        )


def downgrade() -> None:
    op.drop_column("signals", "contact_basis")
