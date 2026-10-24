"""OPS usage ledger enrich + price books.

Revision ID: 163_ops_usage_pricing
Revises: 162_canvas_revisions
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "163_ops_usage_pricing"
down_revision = "162_canvas_revisions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("usage_ledger", sa.Column("backing_provider", sa.String(), nullable=False, server_default=""))
    op.add_column("usage_ledger", sa.Column("backing_model", sa.String(), nullable=False, server_default=""))
    op.add_column(
        "usage_ledger",
        sa.Column("tokens_in_uncached", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "usage_ledger",
        sa.Column("tokens_cache_write", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "usage_ledger",
        sa.Column("tokens_cache_read", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "usage_ledger",
        sa.Column("units", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "usage_ledger",
        sa.Column("unit_kind", sa.String(length=32), nullable=False, server_default="token"),
    )
    op.add_column("usage_ledger", sa.Column("price_book_id", sa.Uuid(), nullable=True))
    op.add_column(
        "usage_ledger",
        sa.Column("price_rule_version", sa.Integer(), nullable=False, server_default="0"),
    )

    op.create_table(
        "price_books",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("slug", sa.String(length=64), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("currency", sa.String(length=8), nullable=False, server_default="usd"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("slug", name="uq_price_books_slug"),
    )
    op.create_index("ix_price_books_is_default", "price_books", ["is_default"])

    op.create_table(
        "price_book_rules",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("price_book_id", sa.Uuid(), sa.ForeignKey("price_books.id"), nullable=False),
        sa.Column("match_kind", sa.String(length=32), nullable=False),
        sa.Column("match_value", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("pricing_mode", sa.String(length=32), nullable=False),
        sa.Column("list_input_cents_per_mtok", sa.Integer(), nullable=True),
        sa.Column("list_output_cents_per_mtok", sa.Integer(), nullable=True),
        sa.Column("markup_multiplier", sa.Float(), nullable=True),
        sa.Column("unit_list_micros", sa.Integer(), nullable=True),
        sa.Column("provider_unit_micros", sa.Integer(), nullable=True),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("effective_from", sa.DateTime(), nullable=True),
        sa.Column("effective_to", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_price_book_rules_book", "price_book_rules", ["price_book_id"])

    op.create_table(
        "tenant_price_bindings",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("price_book_id", sa.Uuid(), sa.ForeignKey("price_books.id"), nullable=False),
        sa.Column("notes", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("tenant_id", name="uq_tenant_price_bindings_tenant"),
    )

    op.create_table(
        "tenant_price_overrides",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("match_kind", sa.String(length=32), nullable=False),
        sa.Column("match_value", sa.String(length=120), nullable=False, server_default=""),
        sa.Column("pricing_mode", sa.String(length=32), nullable=False),
        sa.Column("list_input_cents_per_mtok", sa.Integer(), nullable=True),
        sa.Column("list_output_cents_per_mtok", sa.Integer(), nullable=True),
        sa.Column("markup_multiplier", sa.Float(), nullable=True),
        sa.Column("unit_list_micros", sa.Integer(), nullable=True),
        sa.Column("provider_unit_micros", sa.Integer(), nullable=True),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="10"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("effective_from", sa.DateTime(), nullable=True),
        sa.Column("effective_to", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_tenant_price_overrides_tenant", "tenant_price_overrides", ["tenant_id"])

    op.create_foreign_key(
        "fk_usage_ledger_price_book",
        "usage_ledger",
        "price_books",
        ["price_book_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint("fk_usage_ledger_price_book", "usage_ledger", type_="foreignkey")
    op.drop_table("tenant_price_overrides")
    op.drop_table("tenant_price_bindings")
    op.drop_table("price_book_rules")
    op.drop_index("ix_price_books_is_default", table_name="price_books")
    op.drop_table("price_books")
    for col in (
        "price_rule_version",
        "price_book_id",
        "unit_kind",
        "units",
        "tokens_cache_read",
        "tokens_cache_write",
        "tokens_in_uncached",
        "backing_model",
        "backing_provider",
    ):
        op.drop_column("usage_ledger", col)
