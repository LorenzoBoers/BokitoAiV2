"""Linked SSO identities (Google / Microsoft).

Revision ID: 051_user_identities
Revises: 050_project_canvases
"""

import sqlalchemy as sa
from alembic import op

revision = "051_user_identities"
down_revision = "050_project_canvases"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    tables = set(sa.inspect(conn).get_table_names())
    if "user_identities" in tables:
        return
    op.create_table(
        "user_identities",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("subject", sa.String(), nullable=False),
        sa.Column("email_at_link", sa.String(), nullable=False, server_default=""),
        sa.Column("linked_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("provider", "subject", name="uq_user_identity_provider_subject"),
        sa.UniqueConstraint("user_id", "provider", name="uq_user_identity_user_provider"),
    )
    op.create_index("ix_user_identities_user_id", "user_identities", ["user_id"])
    op.create_index("ix_user_identities_provider", "user_identities", ["provider"])
    op.create_index("ix_user_identities_subject", "user_identities", ["subject"])


def downgrade() -> None:
    op.drop_table("user_identities")
