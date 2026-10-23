"""Rename the accounting specialist back to Boekito.

Revision ID: 148_boekito_name
Revises: 147_canvas_thread_only

Only the catalog default name. A workspace that already renamed the agent
keeps that name.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "148_boekito_name"
down_revision = "147_canvas_thread_only"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "agents" not in tables:
        return
    bind.execute(
        sa.text(
            "UPDATE agents SET name = 'Boekito' "
            "WHERE name = 'Boekhouder' AND slug = 'module-accounting'"
        )
    )
    if "module_agents" in tables:
        bind.execute(
            sa.text(
                "UPDATE agents SET name = 'Boekito' "
                "WHERE name = 'Boekhouder' AND id IN ("
                "  SELECT agent_id FROM module_agents WHERE module_slug = 'accounting'"
                ")"
            )
        )
        bind.execute(
            sa.text(
                "UPDATE agents SET system_prompt = REPLACE(system_prompt, "
                "'You are Boekhouder,', 'You are Boekito,') "
                "WHERE system_prompt LIKE 'You are Boekhouder,%' "
                "AND ("
                "  slug = 'module-accounting' OR id IN ("
                "    SELECT agent_id FROM module_agents WHERE module_slug = 'accounting'"
                "  )"
                ")"
            )
        )
    else:
        bind.execute(
            sa.text(
                "UPDATE agents SET system_prompt = REPLACE(system_prompt, "
                "'You are Boekhouder,', 'You are Boekito,') "
                "WHERE system_prompt LIKE 'You are Boekhouder,%' "
                "AND slug = 'module-accounting'"
            )
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "agents" not in inspector.get_table_names():
        return
    bind.execute(
        sa.text(
            "UPDATE agents SET name = 'Boekhouder' "
            "WHERE name = 'Boekito' AND slug = 'module-accounting'"
        )
    )
