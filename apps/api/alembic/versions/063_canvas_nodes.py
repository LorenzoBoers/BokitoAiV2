"""Canvas nodes — owner project|tenant, Agenda-backed refresh.

Revision ID: 063_canvas_nodes
Revises: 062_project_canvas_document
"""

import sqlalchemy as sa
from alembic import op

revision = "063_canvas_nodes"
down_revision = "062_project_canvas_document"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "project_canvases" not in set(inspector.get_table_names()):
        return
    cols = {c["name"] for c in inspector.get_columns("project_canvases")}
    if "owner_kind" not in cols:
        op.add_column(
            "project_canvases",
            sa.Column("owner_kind", sa.String(length=16), nullable=False, server_default="project"),
        )
    if "owner_id" not in cols:
        op.add_column("project_canvases", sa.Column("owner_id", sa.Uuid(), nullable=True))
    if "managing_agent_id" not in cols:
        op.add_column("project_canvases", sa.Column("managing_agent_id", sa.Uuid(), nullable=True))
    if "refresh_trigger_id" not in cols:
        op.add_column("project_canvases", sa.Column("refresh_trigger_id", sa.Uuid(), nullable=True))

    bind.execute(
        sa.text(
            "UPDATE project_canvases SET owner_kind = 'project', owner_id = project_id "
            "WHERE owner_id IS NULL AND project_id IS NOT NULL"
        )
    )

    uniques = {u["name"] for u in inspector.get_unique_constraints("project_canvases")}
    if "uq_project_canvas_slug" in uniques:
        op.drop_constraint("uq_project_canvas_slug", "project_canvases", type_="unique")
    uniques = {u["name"] for u in inspector.get_unique_constraints("project_canvases")}
    if "uq_canvas_owner_slug" not in uniques:
        op.create_unique_constraint(
            "uq_canvas_owner_slug",
            "project_canvases",
            ["tenant_id", "owner_kind", "owner_id", "slug"],
        )

    inspector = sa.inspect(bind)
    cols = {c["name"] for c in inspector.get_columns("project_canvases")}
    if "project_id" in cols:
        op.alter_column("project_canvases", "project_id", nullable=True)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "project_canvases" not in set(inspector.get_table_names()):
        return
    uniques = {u["name"] for u in inspector.get_unique_constraints("project_canvases")}
    if "uq_canvas_owner_slug" in uniques:
        op.drop_constraint("uq_canvas_owner_slug", "project_canvases", type_="unique")
    cols = {c["name"] for c in inspector.get_columns("project_canvases")}
    for name in ("refresh_trigger_id", "managing_agent_id", "owner_id", "owner_kind"):
        if name in cols:
            op.drop_column("project_canvases", name)
