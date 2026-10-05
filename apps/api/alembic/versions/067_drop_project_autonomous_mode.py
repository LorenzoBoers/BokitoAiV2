"""Drop leftover Project.autonomous_mode.

Revision ID: 067_drop_project_autonomous_mode
Revises: 066_unify_autonomy_dialect

Workspace Govern posture is the only autonomy dial. Queue auto-accept already
follows that posture; the project column was ignored on PATCH.
"""

import sqlalchemy as sa
from alembic import op

revision = "067_drop_project_autonomous_mode"
down_revision = "066_unify_autonomy_dialect"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "projects" not in set(inspector.get_table_names()):
        return
    cols = {c["name"] for c in inspector.get_columns("projects")}
    if "autonomous_mode" in cols:
        op.drop_column("projects", "autonomous_mode")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "projects" not in set(inspector.get_table_names()):
        return
    cols = {c["name"] for c in inspector.get_columns("projects")}
    if "autonomous_mode" not in cols:
        op.add_column(
            "projects",
            sa.Column("autonomous_mode", sa.Boolean(), nullable=False, server_default=sa.false()),
        )
