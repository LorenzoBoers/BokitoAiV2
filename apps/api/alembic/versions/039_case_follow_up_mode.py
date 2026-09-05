"""Add case_types.follow_up_mode (label | track | route).

Revision ID: 039_case_follow_up_mode
Revises: 038_cases
"""

import sqlalchemy as sa
from alembic import op

revision = "039_case_follow_up_mode"
down_revision = "038_cases"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "case_types",
        sa.Column(
            "follow_up_mode",
            sa.String(),
            nullable=False,
            server_default="track",
        ),
    )
    # Platform spam type is label-only: stamp on the thread, not queue work.
    op.execute(
        sa.text(
            "UPDATE case_types SET follow_up_mode = 'label' WHERE slug = 'spam_abuse'"
        )
    )
    # Close open/waiting spam (and other label) cases so they leave the queue.
    op.execute(
        sa.text(
            """
            UPDATE cases
            SET status = 'closed', updated_at = CURRENT_TIMESTAMP
            WHERE status IN ('proposed', 'open', 'waiting_customer', 'waiting_operator')
              AND case_type_id IN (
                SELECT id FROM case_types WHERE follow_up_mode = 'label'
              )
            """
        )
    )


def downgrade() -> None:
    op.drop_column("case_types", "follow_up_mode")
