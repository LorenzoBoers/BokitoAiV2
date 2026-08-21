"""Drop dormant project orchestration and notification-preference tables.

Revision ID: 012_drop_dormant_project_tables
Revises: 011_unify_workstreams

`project_orchestrations` (PO wake cadence fields) and
`project_notification_preferences` had API endpoints but no consumer:
nothing scheduled PO wakes and no notification emitter read the prefs.
Removed instead of wired, per the gap-closing plan.
"""

import sqlalchemy as sa
from alembic import op

revision = "012_drop_dormant_project_tables"
down_revision = "011_unify_workstreams"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "project_notification_preferences" in tables:
        op.drop_table("project_notification_preferences")
    if "project_orchestrations" in tables:
        op.drop_table("project_orchestrations")


def downgrade() -> None:
    op.create_table(
        "project_orchestrations",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), index=True),
        sa.Column(
            "project_id", sa.Uuid(), sa.ForeignKey("projects.id"), index=True, unique=True
        ),
        sa.Column("wake_cadence", sa.String(), nullable=False, server_default="daily"),
        sa.Column("autonomy_mode", sa.String(), nullable=False, server_default="balanced"),
        sa.Column("hitl_sensitivity", sa.String(), nullable=False, server_default="medium"),
        sa.Column("continuous_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("next_po_wake_at", sa.DateTime(), nullable=True),
        sa.Column("last_po_wake_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_table(
        "project_notification_preferences",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), index=True),
        sa.Column("project_id", sa.Uuid(), sa.ForeignKey("projects.id"), index=True),
        sa.Column("event_type", sa.String(), nullable=False),
        sa.Column("channel", sa.String(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
