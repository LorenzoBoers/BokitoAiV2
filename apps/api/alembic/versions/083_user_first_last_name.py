"""Split user display_name into first_name and last_name.

Revision ID: 083_user_first_last_name
Revises: 082_channel_archive
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "083_user_first_last_name"
down_revision = "082_channel_archive"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "users" not in inspector.get_table_names():
        return
    existing = {c["name"] for c in inspector.get_columns("users")}
    with op.batch_alter_table("users") as batch:
        if "first_name" not in existing:
            batch.add_column(sa.Column("first_name", sa.String(), server_default="", nullable=False))
        if "last_name" not in existing:
            batch.add_column(sa.Column("last_name", sa.String(), server_default="", nullable=False))

    # Backfill from display_name: first word → first_name, remainder → last_name.
    rows = bind.execute(sa.text("SELECT id, display_name FROM users")).fetchall()
    for user_id, display_name in rows:
        raw = (display_name or "").strip()
        if not raw:
            continue
        parts = raw.split(None, 1)
        first = parts[0]
        last = parts[1] if len(parts) > 1 else ""
        bind.execute(
            sa.text("UPDATE users SET first_name = :first, last_name = :last WHERE id = :id"),
            {"first": first, "last": last, "id": user_id},
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "users" not in inspector.get_table_names():
        return
    existing = {c["name"] for c in inspector.get_columns("users")}
    with op.batch_alter_table("users") as batch:
        if "last_name" in existing:
            batch.drop_column("last_name")
        if "first_name" in existing:
            batch.drop_column("first_name")
