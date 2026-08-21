"""Drop dead inbox_settings fields (rules_text, labeling_enabled).

Revision ID: 009_inbox_settings_slim
Revises: 008_persona_doc

Neither field was ever read: inbox rules live in the inbox_rules table and
labeling is always on. certainty_threshold stays (used by triage).
"""

import sqlalchemy as sa
from alembic import op

revision = "009_inbox_settings_slim"
down_revision = "008_persona_doc"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {c["name"] for c in sa.inspect(bind).get_columns("inbox_settings")}
    with op.batch_alter_table("inbox_settings") as batch:
        if "rules_text" in columns:
            batch.drop_column("rules_text")
        if "labeling_enabled" in columns:
            batch.drop_column("labeling_enabled")


def downgrade() -> None:
    with op.batch_alter_table("inbox_settings") as batch:
        batch.add_column(sa.Column("rules_text", sa.String(), nullable=False, server_default=""))
        batch.add_column(
            sa.Column("labeling_enabled", sa.Boolean(), nullable=False, server_default=sa.true())
        )
