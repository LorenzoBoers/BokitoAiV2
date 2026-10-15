"""Active agents: unique names per tenant (case-insensitive).

Revision ID: 093_agent_unique_name
Revises: 092_tenant_calendars
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "093_agent_unique_name"
down_revision = "092_tenant_calendars"
branch_labels = None
depends_on = None

_INDEX = "uq_agents_tenant_name_active"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("agents"):
        return
    # Soft-disambiguate any active duplicates before the index lands.
    # Prefer keeping the oldest row's name; later actives get " (2)", " (3)", …
    op.execute(
        sa.text(
            """
            WITH ranked AS (
              SELECT id,
                     tenant_id,
                     name,
                     row_number() OVER (
                       PARTITION BY tenant_id, lower(btrim(name))
                       ORDER BY created_at ASC NULLS LAST, id ASC
                     ) AS rn
              FROM agents
              WHERE is_active IS TRUE
            )
            UPDATE agents AS a
            SET name = ranked.name || ' (' || ranked.rn || ')'
            FROM ranked
            WHERE a.id = ranked.id
              AND ranked.rn > 1
            """
        )
    )
    existing = {idx["name"] for idx in inspector.get_indexes("agents")}
    if _INDEX not in existing:
        op.execute(
            sa.text(
                f"CREATE UNIQUE INDEX {_INDEX} "
                "ON agents (tenant_id, lower(btrim(name))) "
                "WHERE is_active IS TRUE"
            )
        )


def downgrade() -> None:
    op.execute(sa.text(f"DROP INDEX IF EXISTS {_INDEX}"))
