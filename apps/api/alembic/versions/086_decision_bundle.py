"""Decision bundles: cards raised in one agent turn share ``bundle_id``.

Revision ID: 086_decision_bundle
Revises: 085_thread_dates
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "086_decision_bundle"
down_revision = "085_thread_dates"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if table not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(table)}


def upgrade() -> None:
    existing = _columns("decision_requests")
    if not existing:
        return
    if "bundle_id" not in existing:
        with op.batch_alter_table("decision_requests") as batch:
            batch.add_column(sa.Column("bundle_id", sa.String(), server_default="", nullable=False))
    inspector = sa.inspect(op.get_bind())
    names = {i["name"] for i in inspector.get_indexes("decision_requests")}
    if "ix_decision_requests_bundle_id" not in names:
        op.create_index("ix_decision_requests_bundle_id", "decision_requests", ["bundle_id"])


def downgrade() -> None:
    if "bundle_id" in _columns("decision_requests"):
        op.drop_index("ix_decision_requests_bundle_id", table_name="decision_requests")
        with op.batch_alter_table("decision_requests") as batch:
            batch.drop_column("bundle_id")
