"""Sync workforce and blueprint tables (create missing tables via SQLModel metadata)."""

from alembic import op
from sqlmodel import SQLModel

import app.models  # noqa: F401
from app.db.schema_patch import apply_column_patches

revision = "002_schema_sync"
down_revision = "001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    SQLModel.metadata.create_all(bind)
    apply_column_patches(bind)


def downgrade() -> None:
    pass
