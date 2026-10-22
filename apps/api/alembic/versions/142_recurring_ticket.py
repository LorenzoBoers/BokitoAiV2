"""Recurring ticket target on triggers.

A trigger with ``purpose = "recurring_ticket"`` opens a new conversation each
period, files it on the flow label of ``workstream_id`` and in the folder
``project_id``, with a subject from ``title_template``.

Revision ID: 142_recurring_ticket
Revises: 141_membership_scope_hours
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "142_recurring_ticket"
down_revision = "141_membership_scope_hours"
branch_labels = None
depends_on = None


def _columns(bind) -> set[str]:
    return {c["name"] for c in sa.inspect(bind).get_columns("triggers")}


def upgrade() -> None:
    present = _columns(op.get_bind())
    if "project_id" not in present:
        op.add_column("triggers", sa.Column("project_id", sa.Uuid(), sa.ForeignKey("projects.id"), nullable=True))
    if "title_template" not in present:
        op.add_column(
            "triggers",
            sa.Column("title_template", sa.String(length=200), nullable=False, server_default=""),
        )


def downgrade() -> None:
    present = _columns(op.get_bind())
    if "title_template" in present:
        op.drop_column("triggers", "title_template")
    if "project_id" in present:
        op.drop_column("triggers", "project_id")
