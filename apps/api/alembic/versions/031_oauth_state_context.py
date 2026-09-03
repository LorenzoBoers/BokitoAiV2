"""Add oauth_states.context_json for MCP remote OAuth."""

from alembic import op
import sqlalchemy as sa

revision = "031_oauth_state_context"
down_revision = "030_decision_provenance"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "oauth_states",
        sa.Column("context_json", sa.Text(), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_column("oauth_states", "context_json")
