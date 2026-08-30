"""Alembic: calendar_events for Google / Outlook sync.

Revision ID: 020_calendar_events
Revises: 019_module_sources
"""

import sqlalchemy as sa
from alembic import op

revision = "020_calendar_events"
down_revision = "019_module_sources"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("calendar_events"):
        return
    op.create_table(
        "calendar_events",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column(
            "connection_id",
            sa.Uuid(),
            sa.ForeignKey("integration_connections.id"),
            nullable=False,
        ),
        sa.Column("provider", sa.String(), nullable=False, server_default=""),
        sa.Column("external_id", sa.String(), nullable=False, server_default=""),
        sa.Column("calendar_id", sa.String(), nullable=False, server_default="primary"),
        sa.Column("calendar_name", sa.String(), nullable=False, server_default=""),
        sa.Column("title", sa.String(), nullable=False, server_default=""),
        sa.Column("description", sa.String(), nullable=False, server_default=""),
        sa.Column("location", sa.String(), nullable=False, server_default=""),
        sa.Column("start_at", sa.DateTime(), nullable=False),
        sa.Column("end_at", sa.DateTime(), nullable=False),
        sa.Column("all_day", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("status", sa.String(), nullable=False, server_default="confirmed"),
        sa.Column("html_link", sa.String(), nullable=False, server_default=""),
        sa.Column("attendees_json", sa.String(), nullable=False, server_default="[]"),
        sa.Column("metadata_json", sa.String(), nullable=False, server_default="{}"),
        sa.Column("synced_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_calendar_events_tenant_id", "calendar_events", ["tenant_id"])
    op.create_index("ix_calendar_events_connection_id", "calendar_events", ["connection_id"])
    op.create_index("ix_calendar_events_provider", "calendar_events", ["provider"])
    op.create_index("ix_calendar_events_external_id", "calendar_events", ["external_id"])
    op.create_index("ix_calendar_events_start_at", "calendar_events", ["start_at"])
    op.create_index("ix_calendar_events_end_at", "calendar_events", ["end_at"])
    op.create_index(
        "ix_calendar_events_conn_ext",
        "calendar_events",
        ["connection_id", "external_id"],
        unique=True,
    )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("calendar_events"):
        return
    op.drop_index("ix_calendar_events_conn_ext", table_name="calendar_events")
    op.drop_index("ix_calendar_events_end_at", table_name="calendar_events")
    op.drop_index("ix_calendar_events_start_at", table_name="calendar_events")
    op.drop_index("ix_calendar_events_external_id", table_name="calendar_events")
    op.drop_index("ix_calendar_events_provider", table_name="calendar_events")
    op.drop_index("ix_calendar_events_connection_id", table_name="calendar_events")
    op.drop_index("ix_calendar_events_tenant_id", table_name="calendar_events")
    op.drop_table("calendar_events")
