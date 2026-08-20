"""TOTP 2FA columns on users.

Revision ID: 004_user_totp
Revises: 003_baseline

Guarded with an inspector check: on a fresh database the 003 baseline's
`create_all` already creates these columns from the live model metadata, so
this revision only has work to do on databases created before 2FA existed.
"""

import sqlalchemy as sa
from alembic import op

revision = "004_user_totp"
down_revision = "003_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    existing = {col["name"] for col in sa.inspect(bind).get_columns("users")}
    if "totp_enabled" not in existing:
        op.add_column(
            "users",
            sa.Column("totp_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        )
    if "totp_secret" not in existing:
        op.add_column(
            "users", sa.Column("totp_secret", sa.String(), nullable=False, server_default="")
        )
    if "totp_pending_secret" not in existing:
        op.add_column(
            "users",
            sa.Column("totp_pending_secret", sa.String(), nullable=False, server_default=""),
        )


def downgrade() -> None:
    op.drop_column("users", "totp_pending_secret")
    op.drop_column("users", "totp_secret")
    op.drop_column("users", "totp_enabled")
