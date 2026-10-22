"""Canvas content kind and code language.

Existing rows are dashboards. A canvas still has one home thread
(``signal_id``); ``kind`` only changes what the source means.

Revision ID: 143_canvas_kind
Revises: 142_recurring_ticket
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "143_canvas_kind"
down_revision = "142_recurring_ticket"
branch_labels = None
depends_on = None


def _columns(bind) -> set[str]:
    return {c["name"] for c in sa.inspect(bind).get_columns("project_canvases")}


def upgrade() -> None:
    present = _columns(op.get_bind())
    if "kind" not in present:
        op.add_column(
            "project_canvases",
            sa.Column("kind", sa.String(length=16), nullable=False, server_default="dashboard"),
        )
    if "language" not in present:
        op.add_column("project_canvases", sa.Column("language", sa.String(length=32), nullable=True))


def downgrade() -> None:
    present = _columns(op.get_bind())
    if "language" in present:
        op.drop_column("project_canvases", "language")
    if "kind" in present:
        op.drop_column("project_canvases", "kind")
