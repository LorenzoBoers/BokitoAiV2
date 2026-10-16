"""Required short job title on agents (between name and description).

Revision ID: 099_agent_job_title
Revises: 098_signal_tag_color
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "099_agent_job_title"
down_revision = "098_signal_tag_color"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "agents" not in inspector.get_table_names():
        return
    existing = {c["name"] for c in inspector.get_columns("agents")}
    if "job_title" in existing:
        return
    with op.batch_alter_table("agents") as batch:
        batch.add_column(sa.Column("job_title", sa.String(length=20), nullable=False, server_default=""))
    # Backfill empty titles from the first 20 chars of the name so the UI is not blank.
    bind.execute(
        sa.text(
            "UPDATE agents SET job_title = SUBSTR(TRIM(name), 1, 20) "
            "WHERE job_title = '' OR job_title IS NULL"
        )
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "agents" not in inspector.get_table_names():
        return
    existing = {c["name"] for c in inspector.get_columns("agents")}
    if "job_title" not in existing:
        return
    with op.batch_alter_table("agents") as batch:
        batch.drop_column("job_title")
