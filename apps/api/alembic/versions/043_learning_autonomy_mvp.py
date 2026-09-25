"""Knowledge, learning, contact identity and scoped autonomy MVP fields.

Revision ID: 043_learning_autonomy_mvp
Revises: 042_retire_legacy_routing
"""

import sqlalchemy as sa
from alembic import op

revision = "043_learning_autonomy_mvp"
down_revision = "042_retire_legacy_routing"
branch_labels = None
depends_on = None


def _columns(conn, table: str) -> set[str]:
    inspector = sa.inspect(conn)
    if table not in inspector.get_table_names():
        return set()
    return {column["name"] for column in inspector.get_columns(table)}


def _add(table: str, column: sa.Column) -> None:
    if column.name not in _columns(op.get_bind(), table):
        op.add_column(table, column)


def upgrade() -> None:
    _add("workspace_docs", sa.Column("internal", sa.Boolean(), nullable=False, server_default=sa.true()))
    _add("doc_chunks", sa.Column("internal", sa.Boolean(), nullable=False, server_default=sa.true()))
    _add("signals", sa.Column("is_example", sa.Boolean(), nullable=False, server_default=sa.false()))
    _add("case_types", sa.Column("send_mode", sa.String(), nullable=False, server_default="draft"))
    _add("case_types", sa.Column("autonomy_level", sa.String(), nullable=False, server_default="approval"))
    _add("workstreams", sa.Column("autonomy_level", sa.String(), nullable=False, server_default="approval"))
    _add("agent_runs", sa.Column("signal_type_id", sa.Uuid(), nullable=True))
    _add("usage_ledger", sa.Column("signal_type_id", sa.Uuid(), nullable=True))
    _add("usage_ledger", sa.Column("workstream_run_id", sa.Uuid(), nullable=True))
    _add("contacts", sa.Column("merged_into_id", sa.Uuid(), nullable=True))
    _add("feedback_entries", sa.Column("correction_key", sa.String(), nullable=False, server_default=""))
    _add("feedback_entries", sa.Column("metadata_json", sa.String(), nullable=False, server_default="{}"))


def downgrade() -> None:
    for table, columns in (
        ("feedback_entries", ("metadata_json", "correction_key")),
        ("contacts", ("merged_into_id",)),
        ("usage_ledger", ("workstream_run_id", "signal_type_id")),
        ("agent_runs", ("signal_type_id",)),
        ("workstreams", ("autonomy_level",)),
        ("case_types", ("autonomy_level", "send_mode")),
        ("signals", ("is_example",)),
        ("doc_chunks", ("internal",)),
        ("workspace_docs", ("internal",)),
    ):
        existing = _columns(op.get_bind(), table)
        for column in columns:
            if column in existing:
                op.drop_column(table, column)
