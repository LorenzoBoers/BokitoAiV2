"""Agent availability for calls, and drop orientation triggers.

Orientation is an ambient check on the agent, not an agenda item.

Revision ID: 151_ambient_availability
Revises: 150_knowledge_lessons
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "151_ambient_availability"
down_revision = "150_knowledge_lessons"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("users")} if inspector.has_table("users") else set()
    if "availability" not in columns:
        op.add_column("users", sa.Column("availability", sa.String(), nullable=False, server_default="online"))
    if "availability_until" not in columns:
        op.add_column("users", sa.Column("availability_until", sa.DateTime(), nullable=True))
    if inspector.has_table("users") and "away" in columns:
        bind.execute(
            sa.text(
                "UPDATE users SET availability = 'away' "
                "WHERE away = :away AND (availability = 'online' OR availability IS NULL)"
            ),
            {"away": True},
        )
    if inspector.has_table("triggers"):
        bind.execute(sa.text("DELETE FROM triggers WHERE purpose = 'orientation'"))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("users"):
        return
    columns = {col["name"] for col in inspector.get_columns("users")}
    if "availability_until" in columns:
        op.drop_column("users", "availability_until")
    if "availability" in columns:
        op.drop_column("users", "availability")
