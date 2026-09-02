"""Knowledge hub: agent_id on docs + document-level task links.

Revision ID: 029_knowledge_hub_scopes
Revises: 028_inbox_rules_routing
"""

import sqlalchemy as sa
from alembic import op

revision = "029_knowledge_hub_scopes"
down_revision = "028_inbox_rules_routing"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "workspace_docs",
        sa.Column("agent_id", sa.Uuid(), nullable=True),
    )
    op.create_index("ix_workspace_docs_agent_id", "workspace_docs", ["agent_id"])
    op.create_foreign_key(
        "fk_workspace_docs_agent_id_agents",
        "workspace_docs",
        "agents",
        ["agent_id"],
        ["id"],
    )

    op.add_column(
        "task_doc_links",
        sa.Column("doc_id", sa.Uuid(), nullable=True),
    )
    op.create_index("ix_task_doc_links_doc_id", "task_doc_links", ["doc_id"])
    op.create_foreign_key(
        "fk_task_doc_links_doc_id_workspace_docs",
        "task_doc_links",
        "workspace_docs",
        ["doc_id"],
        ["id"],
    )

    # Backfill doc_id from section so document-level queries work for legacy links.
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        op.execute(
            """
            UPDATE task_doc_links
            SET doc_id = (
                SELECT s.doc_id FROM project_doc_sections AS s
                WHERE s.id = task_doc_links.section_id
            )
            WHERE doc_id IS NULL AND section_id IS NOT NULL
            """
        )
    else:
        op.execute(
            """
            UPDATE task_doc_links AS t
            SET doc_id = s.doc_id
            FROM project_doc_sections AS s
            WHERE t.section_id = s.id
              AND t.doc_id IS NULL
            """
        )

    # section_id becomes optional for new document-level links.
    op.alter_column("task_doc_links", "section_id", existing_type=sa.Uuid(), nullable=True)

    # One document-level link per task+doc; section links may share the same doc_id.
    op.create_index(
        "uq_task_doc_links_task_doc",
        "task_doc_links",
        ["task_id", "doc_id"],
        unique=True,
        postgresql_where=sa.text("section_id IS NULL AND doc_id IS NOT NULL"),
        sqlite_where=sa.text("section_id IS NULL AND doc_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_task_doc_links_task_doc", table_name="task_doc_links")
    op.alter_column("task_doc_links", "section_id", existing_type=sa.Uuid(), nullable=False)
    op.drop_constraint("fk_task_doc_links_doc_id_workspace_docs", "task_doc_links", type_="foreignkey")
    op.drop_index("ix_task_doc_links_doc_id", table_name="task_doc_links")
    op.drop_column("task_doc_links", "doc_id")

    op.drop_constraint("fk_workspace_docs_agent_id_agents", "workspace_docs", type_="foreignkey")
    op.drop_index("ix_workspace_docs_agent_id", table_name="workspace_docs")
    op.drop_column("workspace_docs", "agent_id")
