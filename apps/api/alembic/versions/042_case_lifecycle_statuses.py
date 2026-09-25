"""Normalize case lifecycle statuses.

Revision ID: 042_case_lifecycle_statuses
Revises: 041_case_type_default_project
"""

from alembic import op

revision = "042_case_lifecycle_statuses"
down_revision = "041_case_type_default_project"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE cases
        SET status = CASE
            WHEN status = 'proposed' THEN 'proposed'
            WHEN status IN ('waiting_customer', 'waiting_operator', 'waiting') THEN 'waiting'
            WHEN status IN ('closed', 'cancelled', 'dismissed', 'done') THEN 'done'
            ELSE 'open'
        END
        """
    )


def downgrade() -> None:
    # The old sub-status cannot be reconstructed from the canonical lifecycle.
    pass
