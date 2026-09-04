"""Personal Bokito assistant: per-tenant helper agent + cross-workspace memory.

Adds the ``user_assistant_memory`` table, which is deliberately the only
assistant table without a ``tenant_id``: it follows a person into every
workspace they belong to. The Bokito agent rows themselves are seeded by
``app.services.personal_assistant.ensure_personal_assistants`` on startup,
so this migration only backfills the schema it needs.

Revision ID: 036_personal_assistant
Revises: 035_workstream_templates
"""

import sqlalchemy as sa
from alembic import op

revision = "036_personal_assistant"
down_revision = "035_workstream_templates"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_assistant_memory",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("key", sa.String(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
    )
    op.create_index(
        "ix_user_assistant_memory_user_id", "user_assistant_memory", ["user_id"]
    )
    op.create_index("ix_user_assistant_memory_key", "user_assistant_memory", ["key"])
    op.create_unique_constraint(
        "uq_user_assistant_memory_user_key",
        "user_assistant_memory",
        ["user_id", "key"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_user_assistant_memory_user_key", "user_assistant_memory", type_="unique"
    )
    op.drop_index("ix_user_assistant_memory_key", table_name="user_assistant_memory")
    op.drop_index("ix_user_assistant_memory_user_id", table_name="user_assistant_memory")
    op.drop_table("user_assistant_memory")
