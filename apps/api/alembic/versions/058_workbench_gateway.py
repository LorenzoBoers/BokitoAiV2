"""Workbench gateway: job ledger columns and job-scoped API tokens.

Revision ID: 058_workbench_gateway
Revises: 057_teams_owner_turn
"""

import sqlalchemy as sa
from alembic import op

revision = "058_workbench_gateway"
down_revision = "057_teams_owner_turn"
branch_labels = None
depends_on = None


def _cols(inspector, table: str) -> set[str]:
    return {col["name"] for col in inspector.get_columns(table)}


def _add(table: str, existing: set[str], column: sa.Column) -> None:
    if column.name not in existing:
        op.add_column(table, column)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "work_jobs" in tables:
        cols = _cols(inspector, "work_jobs")
        _add("work_jobs", cols, sa.Column("external_id", sa.String(), nullable=True))
        _add("work_jobs", cols, sa.Column("decision_id", sa.Uuid(), nullable=True))
        _add("work_jobs", cols, sa.Column("requested_by_user_id", sa.Uuid(), nullable=True))
        _add("work_jobs", cols, sa.Column("job_token_id", sa.Uuid(), nullable=True))
        _add("work_jobs", cols, sa.Column("last_event_at", sa.DateTime(), nullable=True))
        _add("work_jobs", cols, sa.Column("last_polled_at", sa.DateTime(), nullable=True))
        _add("work_jobs", cols, sa.Column("outcome", sa.String(), nullable=True))
        _add("work_jobs", cols, sa.Column("budget_json", sa.String(), nullable=False, server_default="{}"))
        _add(
            "work_jobs",
            cols,
            sa.Column("progress_message_id", sa.Uuid(), nullable=True),
        )
        _add(
            "work_jobs",
            cols,
            sa.Column("seen_event_ids_json", sa.String(), nullable=False, server_default="[]"),
        )
        cols = _cols(inspector, "work_jobs")
        existing_ix = {ix["name"] for ix in inspector.get_indexes("work_jobs")}
        if "ix_work_jobs_external_id" not in existing_ix and "external_id" in cols:
            op.create_index("ix_work_jobs_external_id", "work_jobs", ["external_id"])
        if "uq_work_jobs_provider_external_id" not in existing_ix and "external_id" in cols:
            op.create_index(
                "uq_work_jobs_provider_external_id",
                "work_jobs",
                ["provider", "external_id"],
                unique=True,
            )

    if "api_tokens" in tables:
        cols = _cols(inspector, "api_tokens")
        _add("api_tokens", cols, sa.Column("job_id", sa.Uuid(), nullable=True))
        _add("api_tokens", cols, sa.Column("expires_at", sa.DateTime(), nullable=True))
        _add(
            "api_tokens",
            cols,
            sa.Column("tool_allowlist_json", sa.String(), nullable=False, server_default="[]"),
        )
        cols = _cols(inspector, "api_tokens")
        existing_ix = {ix["name"] for ix in inspector.get_indexes("api_tokens")}
        if "ix_api_tokens_job_id" not in existing_ix and "job_id" in cols:
            op.create_index("ix_api_tokens_job_id", "api_tokens", ["job_id"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "work_jobs" in tables:
        existing_ix = {ix["name"] for ix in inspector.get_indexes("work_jobs")}
        for name in ("uq_work_jobs_provider_external_id", "ix_work_jobs_external_id"):
            if name in existing_ix:
                op.drop_index(name, table_name="work_jobs")
        cols = _cols(inspector, "work_jobs")
        for col in (
            "seen_event_ids_json",
            "progress_message_id",
            "budget_json",
            "outcome",
            "last_polled_at",
            "last_event_at",
            "job_token_id",
            "requested_by_user_id",
            "decision_id",
            "external_id",
        ):
            if col in cols:
                op.drop_column("work_jobs", col)

    if "api_tokens" in tables:
        existing_ix = {ix["name"] for ix in inspector.get_indexes("api_tokens")}
        if "ix_api_tokens_job_id" in existing_ix:
            op.drop_index("ix_api_tokens_job_id", table_name="api_tokens")
        cols = _cols(inspector, "api_tokens")
        for col in ("tool_allowlist_json", "expires_at", "job_id"):
            if col in cols:
                op.drop_column("api_tokens", col)
