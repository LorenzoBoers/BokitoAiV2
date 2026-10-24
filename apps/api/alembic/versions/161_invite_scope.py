"""Scope chosen when inviting a person.

``invites.scope`` is ``workspace`` (default) or ``departments``. Accepting the
invite copies it onto the membership. Owners and admins stay on workspace.

Revision ID: 161_invite_scope
Revises: 160_module_tools_by_department
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "161_invite_scope"
down_revision = "160_module_tools_by_department"
branch_labels = None
depends_on = None


def _columns(bind) -> set[str]:
    return {c["name"] for c in sa.inspect(bind).get_columns("invites")}


def upgrade() -> None:
    if "scope" not in _columns(op.get_bind()):
        op.add_column(
            "invites",
            sa.Column("scope", sa.String(length=16), nullable=False, server_default="workspace"),
        )


def downgrade() -> None:
    if "scope" in _columns(op.get_bind()):
        op.drop_column("invites", "scope")
