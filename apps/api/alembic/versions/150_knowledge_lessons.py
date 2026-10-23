"""Labels and evidence on knowledge sections.

A lesson is a section with a knowledge_evidence row, not a section whose
status happens to be draft. Labels live on doc_section_tag_links so a label
change does not need a new embedding.

Revision ID: 150_knowledge_lessons
Revises: 149_drop_flow_destination
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "150_knowledge_lessons"
down_revision = "149_drop_flow_destination"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("doc_section_tag_links"):
        op.create_table(
            "doc_section_tag_links",
            sa.Column("section_id", sa.Uuid(), sa.ForeignKey("doc_sections.id"), primary_key=True),
            sa.Column("tag_id", sa.Uuid(), sa.ForeignKey("signal_tags.id"), primary_key=True),
            sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_doc_section_tag_links_tenant_id", "doc_section_tag_links", ["tenant_id"])
        op.create_index(
            "ix_doc_section_tag_links_tenant_tag",
            "doc_section_tag_links",
            ["tenant_id", "tag_id"],
        )
    if not inspector.has_table("knowledge_evidence"):
        op.create_table(
            "knowledge_evidence",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
            sa.Column("section_id", sa.Uuid(), sa.ForeignKey("doc_sections.id"), nullable=False),
            sa.Column("kind", sa.String(), nullable=False),
            sa.Column("signal_id", sa.Uuid(), sa.ForeignKey("signals.id"), nullable=True),
            sa.Column("source_ref", sa.String(), nullable=False, server_default=""),
            sa.Column("agent_id", sa.Uuid(), sa.ForeignKey("agents.id"), nullable=True),
            sa.Column("tag_ids_json", sa.String(), nullable=False, server_default="[]"),
            sa.Column("excerpt", sa.String(), nullable=False, server_default=""),
            sa.Column("deferred_until", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("section_id", "source_ref", name="uq_knowledge_evidence_source"),
        )
        op.create_index("ix_knowledge_evidence_tenant_id", "knowledge_evidence", ["tenant_id"])
        op.create_index("ix_knowledge_evidence_section_id", "knowledge_evidence", ["section_id"])
        op.create_index("ix_knowledge_evidence_kind", "knowledge_evidence", ["kind"])
        op.create_index("ix_knowledge_evidence_signal_id", "knowledge_evidence", ["signal_id"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("knowledge_evidence"):
        op.drop_table("knowledge_evidence")
    if inspector.has_table("doc_section_tag_links"):
        op.drop_table("doc_section_tag_links")
