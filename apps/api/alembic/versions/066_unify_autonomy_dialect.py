"""Store one autonomy dialect on types and playbooks.

Revision ID: 066_unify_autonomy_dialect
Revises: 065_project_token_budget

Maps legacy ``approval`` / ``auto`` to ``assisted`` / ``autonomous`` so Signal
types, playbooks, and agents share Manual / Assisted / Autonomous.
"""

import sqlalchemy as sa
from alembic import op

revision = "066_unify_autonomy_dialect"
down_revision = "065_project_token_budget"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "case_types" in tables:
        bind.execute(sa.text("UPDATE case_types SET autonomy_level = 'assisted' WHERE autonomy_level = 'approval'"))
        bind.execute(sa.text("UPDATE case_types SET autonomy_level = 'autonomous' WHERE autonomy_level = 'auto'"))
    if "workstreams" in tables:
        bind.execute(sa.text("UPDATE workstreams SET autonomy_level = 'assisted' WHERE autonomy_level = 'approval'"))
        bind.execute(sa.text("UPDATE workstreams SET autonomy_level = 'autonomous' WHERE autonomy_level = 'auto'"))
    if "agents" in tables:
        bind.execute(sa.text("UPDATE agents SET autonomy_level = 'assisted' WHERE autonomy_level = 'approval'"))
        bind.execute(sa.text("UPDATE agents SET autonomy_level = 'autonomous' WHERE autonomy_level = 'auto'"))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "case_types" in tables:
        bind.execute(sa.text("UPDATE case_types SET autonomy_level = 'approval' WHERE autonomy_level = 'assisted'"))
        bind.execute(sa.text("UPDATE case_types SET autonomy_level = 'auto' WHERE autonomy_level = 'autonomous'"))
    if "workstreams" in tables:
        bind.execute(sa.text("UPDATE workstreams SET autonomy_level = 'approval' WHERE autonomy_level = 'assisted'"))
        bind.execute(sa.text("UPDATE workstreams SET autonomy_level = 'auto' WHERE autonomy_level = 'autonomous'"))
    if "agents" in tables:
        bind.execute(sa.text("UPDATE agents SET autonomy_level = 'approval' WHERE autonomy_level = 'assisted'"))
        bind.execute(sa.text("UPDATE agents SET autonomy_level = 'auto' WHERE autonomy_level = 'autonomous'"))
