"""Reactivate company agents; pause/sleep is no longer an operator state.

Revision ID: 025_drop_agent_pause
Revises: 024_agent_max_cost_cents

Operators archive agents to remove them from the library. Paused/sleeping
company agents are woken so Communication and Agenda see them again.
Archived rows (kind=archived) stay inactive.
"""

import sqlalchemy as sa
from alembic import op

revision = "025_drop_agent_pause"
down_revision = "024_agent_max_cost_cents"
branch_labels = None
depends_on = None


def upgrade() -> None:
    agents = sa.table(
        "agents",
        sa.column("kind", sa.String()),
        sa.column("is_active", sa.Boolean()),
        sa.column("runtime_status", sa.String()),
    )
    op.execute(
        agents.update()
        .where(agents.c.kind == "company")
        .where(
            sa.or_(
                agents.c.is_active.is_(False),
                agents.c.runtime_status.in_(("sleeping", "paused", "inactive")),
            )
        )
        .values(is_active=True, runtime_status="standby")
    )


def downgrade() -> None:
    # Pause was removed as a product concept; nothing to restore.
    pass
