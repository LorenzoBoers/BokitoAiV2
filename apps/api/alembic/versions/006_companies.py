"""CRM companies table + contacts.company_id.

Revision ID: 006_companies
Revises: 005_webhooks

Guarded with inspector checks: fresh databases get these from the 003
baseline's create_all against live model metadata.
"""

import sqlalchemy as sa
from alembic import op

revision = "006_companies"
down_revision = "005_webhooks"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "companies" not in tables:
        op.create_table(
            "companies",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
            sa.Column("name", sa.String(), nullable=False, server_default=""),
            sa.Column("domain", sa.String(), nullable=False, server_default=""),
            sa.Column("website", sa.String(), nullable=False, server_default=""),
            sa.Column("notes", sa.String(), nullable=False, server_default=""),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_companies_tenant_id", "companies", ["tenant_id"])
        op.create_index("ix_companies_domain", "companies", ["domain"])
    contact_columns = {col["name"] for col in inspector.get_columns("contacts")}
    if "company_id" not in contact_columns:
        op.add_column("contacts", sa.Column("company_id", sa.Uuid(), nullable=True))
        op.create_index("ix_contacts_company_id", "contacts", ["company_id"])


def downgrade() -> None:
    op.drop_column("contacts", "company_id")
    op.drop_table("companies")
