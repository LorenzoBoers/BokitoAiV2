"""The flow's autonomy dial replaces Always review.

``workstreams.autonomy``: "" follows the channel and workspace; manual,
assisted or autonomous sets this flow's mode under the Govern ceiling.
Always review on becomes assisted.

Revision ID: 140_flow_autonomy
Revises: 139_label_is_work_kind
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "140_flow_autonomy"
down_revision = "139_label_is_work_kind"
branch_labels = None
depends_on = None


def _columns(bind) -> set[str]:
    return {c["name"] for c in sa.inspect(bind).get_columns("workstreams")}


def upgrade() -> None:
    bind = op.get_bind()
    present = _columns(bind)
    if "autonomy" not in present:
        op.add_column(
            "workstreams", sa.Column("autonomy", sa.String(length=16), nullable=False, server_default="")
        )
    if "always_review" in present:
        op.execute(sa.text("UPDATE workstreams SET autonomy = 'assisted' WHERE always_review"))
        op.drop_column("workstreams", "always_review")


def downgrade() -> None:
    bind = op.get_bind()
    present = _columns(bind)
    if "always_review" not in present:
        op.add_column(
            "workstreams",
            sa.Column("always_review", sa.Boolean(), nullable=False, server_default=sa.false()),
        )
        op.execute(
            sa.text("UPDATE workstreams SET always_review = TRUE WHERE autonomy IN ('manual', 'assisted')")
        )
    if "autonomy" in present:
        op.drop_column("workstreams", "autonomy")
