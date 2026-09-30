"""Agent managed provenance columns for stack/module reconcile.

Revision ID: 052_agent_managed_provenance
Revises: 051_user_identities
"""

import sqlalchemy as sa
from alembic import op

revision = "052_agent_managed_provenance"
down_revision = "051_user_identities"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    cols = {c["name"] for c in sa.inspect(conn).get_columns("agents")}
    if "managed_origin" not in cols:
        op.add_column(
            "agents",
            sa.Column("managed_origin", sa.String(), nullable=False, server_default=""),
        )
    if "managed_ref" not in cols:
        op.add_column(
            "agents",
            sa.Column("managed_ref", sa.String(), nullable=False, server_default=""),
        )
    if "template_slug" not in cols:
        op.add_column(
            "agents",
            sa.Column("template_slug", sa.String(), nullable=False, server_default=""),
        )
    op.create_index(
        "ix_agents_managed_lookup",
        "agents",
        ["tenant_id", "managed_origin", "managed_ref", "template_slug"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_agents_managed_lookup", table_name="agents")
    op.drop_column("agents", "template_slug")
    op.drop_column("agents", "managed_ref")
    op.drop_column("agents", "managed_origin")
