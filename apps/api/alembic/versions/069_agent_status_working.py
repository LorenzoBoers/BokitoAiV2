"""Agent runtime status vocabulary: standby | working | error.

Rewrites legacy ``active``/``running`` to ``working`` and any other legacy
value (``sleeping``, ``paused``, ``inactive``) to ``standby``; ``is_active``
already carries deactivation.

Revision ID: 069_agent_status_working
Revises: 068_agent_current_signal
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "069_agent_status_working"
down_revision = "068_agent_current_signal"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if "agents" not in set(sa.inspect(bind).get_table_names()):
        return
    op.execute("UPDATE agents SET runtime_status='working' WHERE runtime_status IN ('active', 'running')")
    op.execute(
        "UPDATE agents SET runtime_status='standby' "
        "WHERE runtime_status IS NULL OR runtime_status NOT IN ('standby', 'working', 'error')"
    )


def downgrade() -> None:
    bind = op.get_bind()
    if "agents" not in set(sa.inspect(bind).get_table_names()):
        return
    op.execute("UPDATE agents SET runtime_status='active' WHERE runtime_status='working'")
