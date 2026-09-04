"""Thread assurance columns plus pending customer verify tokens.

Adds live verification state on ``signals`` and the single-use magic-link
table ``customer_verify_tokens``. Also stores per-module customer-tool
opt-in flags on ``module_installs``.

Revision ID: 037_thread_assurance
Revises: 036_personal_assistant
"""

import sqlalchemy as sa
from alembic import op

revision = "037_thread_assurance"
down_revision = "036_personal_assistant"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "signals",
        sa.Column("assurance_level", sa.String(), nullable=False, server_default=""),
    )
    op.add_column(
        "signals",
        sa.Column("assurance_contact_id", sa.Uuid(), nullable=True),
    )
    op.add_column(
        "signals",
        sa.Column("assurance_email", sa.String(), nullable=False, server_default=""),
    )
    op.add_column(
        "signals",
        sa.Column("assurance_expires_at", sa.DateTime(), nullable=True),
    )
    op.add_column(
        "signals",
        sa.Column("assurance_verified_at", sa.DateTime(), nullable=True),
    )
    op.create_index(
        "ix_signals_assurance_expires_at", "signals", ["assurance_expires_at"]
    )
    op.create_foreign_key(
        "fk_signals_assurance_contact_id",
        "signals",
        "contacts",
        ["assurance_contact_id"],
        ["id"],
    )

    op.add_column(
        "module_installs",
        sa.Column(
            "customer_tools_json",
            sa.Text(),
            nullable=False,
            server_default="{}",
        ),
    )

    op.create_table(
        "customer_verify_tokens",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("signal_id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(), nullable=False, server_default=""),
        sa.Column("contact_id", sa.Uuid(), nullable=True),
        sa.Column("token_hash", sa.String(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("used_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["signal_id"], ["signals.id"]),
        sa.ForeignKeyConstraint(["contact_id"], ["contacts.id"]),
    )
    op.create_index(
        "ix_customer_verify_tokens_tenant_id",
        "customer_verify_tokens",
        ["tenant_id"],
    )
    op.create_index(
        "ix_customer_verify_tokens_signal_id",
        "customer_verify_tokens",
        ["signal_id"],
    )
    op.create_index(
        "ix_customer_verify_tokens_token_hash",
        "customer_verify_tokens",
        ["token_hash"],
        unique=True,
    )
    op.create_index(
        "ix_customer_verify_tokens_expires_at",
        "customer_verify_tokens",
        ["expires_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_customer_verify_tokens_expires_at", table_name="customer_verify_tokens"
    )
    op.drop_index(
        "ix_customer_verify_tokens_token_hash", table_name="customer_verify_tokens"
    )
    op.drop_index(
        "ix_customer_verify_tokens_signal_id", table_name="customer_verify_tokens"
    )
    op.drop_index(
        "ix_customer_verify_tokens_tenant_id", table_name="customer_verify_tokens"
    )
    op.drop_table("customer_verify_tokens")
    op.drop_column("module_installs", "customer_tools_json")
    op.drop_constraint("fk_signals_assurance_contact_id", "signals", type_="foreignkey")
    op.drop_index("ix_signals_assurance_expires_at", table_name="signals")
    op.drop_column("signals", "assurance_verified_at")
    op.drop_column("signals", "assurance_expires_at")
    op.drop_column("signals", "assurance_email")
    op.drop_column("signals", "assurance_contact_id")
    op.drop_column("signals", "assurance_level")
