"""Add signals.handoff_session_json for nestable multi-agent handoffs.

Revision ID: 100_handoff_session_json
Revises: 099_agent_job_title
Create Date: 2026-10-15
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "100_handoff_session_json"
down_revision = "099_agent_job_title"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "signals",
        sa.Column("handoff_session_json", sa.Text(), server_default="{}", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("signals", "handoff_session_json")
