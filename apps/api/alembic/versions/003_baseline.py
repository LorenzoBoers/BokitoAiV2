"""Baseline: full current schema from SQLModel metadata + frozen patches.

This revision reproduces exactly what `init_db` used to do at every startup:
`create_all` for missing tables, the frozen `schema_patch` column additions,
and the idempotent data repairs. Running it against an existing production
database is a no-op for anything already present, so no manual `alembic stamp`
is needed at cutover — `upgrade head` converges fresh and existing databases
to the same state.

From this revision on, every schema change must be a new Alembic revision
with explicit DDL. `schema_patch.py` is frozen (see its module docstring).
"""

from alembic import op
from sqlmodel import SQLModel

import app.models  # noqa: F401 — register every table on SQLModel.metadata
from app.db.schema_patch import apply_column_patches, apply_data_repairs

revision = "003_baseline"
down_revision = "002_schema_sync"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    SQLModel.metadata.create_all(bind)
    apply_column_patches(bind)
    apply_data_repairs(bind)


def downgrade() -> None:
    raise RuntimeError("The baseline revision cannot be downgraded.")
