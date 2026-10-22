"""Membership scope and weekly hours.

``memberships.scope``: workspace (default) sees every conversation the channel
ACL allows; departments (freelancers) sees only conversations whose flow label
belongs to a department they are in, assigned to them, or where they take part.
``memberships.hours_per_week``: available hours, for capacity in orientation.

Revision ID: 141_membership_scope_hours
Revises: 140_flow_autonomy
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "141_membership_scope_hours"
down_revision = "140_flow_autonomy"
branch_labels = None
depends_on = None


def _columns(bind) -> set[str]:
    return {c["name"] for c in sa.inspect(bind).get_columns("memberships")}


def upgrade() -> None:
    present = _columns(op.get_bind())
    if "scope" not in present:
        op.add_column(
            "memberships",
            sa.Column("scope", sa.String(length=16), nullable=False, server_default="workspace"),
        )
    if "hours_per_week" not in present:
        op.add_column("memberships", sa.Column("hours_per_week", sa.Integer(), nullable=True))


def downgrade() -> None:
    present = _columns(op.get_bind())
    if "hours_per_week" in present:
        op.drop_column("memberships", "hours_per_week")
    if "scope" in present:
        op.drop_column("memberships", "scope")
