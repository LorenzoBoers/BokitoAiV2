"""Drop Agent managed provenance columns.

Revision ID: 115_drop_agent_managed
Revises: 114_drop_workstream_projects

Pack agents are identified by slug + ModuleAgent / ModuleInstall. The
managed_origin / managed_ref / template_slug columns on agents are unused.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "115_drop_agent_managed"
down_revision = "114_drop_workstream_projects"
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()
    insp = sa.inspect(conn)
    indexes = {idx["name"] for idx in insp.get_indexes("agents")}
    if "ix_agents_managed_lookup" in indexes:
        op.drop_index("ix_agents_managed_lookup", table_name="agents")
    cols = {c["name"] for c in insp.get_columns("agents")}
    for name in ("template_slug", "managed_ref", "managed_origin"):
        if name in cols:
            op.drop_column("agents", name)


def downgrade() -> None:
    conn = op.get_bind()
    cols = {c["name"] for c in sa.inspect(conn).get_columns("agents")}
    if "managed_origin" not in cols:
        op.add_column(
            "agents",
            sa.Column("managed_origin", sa.String(), nullable=False, server_default=""),
        )
    if "managed_ref" not in cols:
        op.add_column(
            "agents",
            sa.Column("managed_ref", sa.String(), nullable=False, server_default=""),
        )
    if "template_slug" not in cols:
        op.add_column(
            "agents",
            sa.Column("template_slug", sa.String(), nullable=False, server_default=""),
        )
    op.create_index(
        "ix_agents_managed_lookup",
        "agents",
        ["tenant_id", "managed_origin", "managed_ref", "template_slug"],
        unique=False,
    )
