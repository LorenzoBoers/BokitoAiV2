"""One autonomy dial: drop label and flow autonomy, keep Always review on the flow.

Revision ID: 124_one_autonomy
Revises: 123_autonomy_ceiling

A flow whose own autonomy was manual or assisted, or whose label sent drafts
only (send_mode draft/ask, autonomy manual/assisted), starts with
always_review. Labels without a flow lose their setting; the count is printed
for the operator log. Then signal_tags.send_mode, signal_tags.autonomy_level,
workstreams.autonomy_level and contacts.ai_handling are dropped.

Every value that changes or disappears is stored in schema_value_backups
first; the downgrade puts it back.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

from app.db import value_backups

revision = "124_one_autonomy"
down_revision = "123_autonomy_ceiling"
branch_labels = None
depends_on = None

_STRICT_TAG = (
    "(send_mode IN ('draft', 'ask') OR autonomy_level IN ('manual', 'assisted', 'approval'))"
)
_STRICT_FLOW = "autonomy_level IN ('manual', 'assisted', 'approval')"

# (table, column, rows worth keeping)
_DROPPED = (
    ("signal_tags", "send_mode", "send_mode IS NOT NULL AND send_mode <> 'send'"),
    ("signal_tags", "autonomy_level", "autonomy_level IS NOT NULL AND autonomy_level <> ''"),
    ("workstreams", "autonomy_level", "autonomy_level IS NOT NULL AND autonomy_level <> ''"),
    ("contacts", "ai_handling", "ai_handling IS NOT NULL AND ai_handling <> ''"),
)


def _columns(inspector, table: str) -> set[str]:
    return {column["name"] for column in inspector.get_columns(table)}


def _drop(table: str, names: list[str]) -> None:
    if not names:
        return
    with op.batch_alter_table(table) as batch:
        for name in names:
            batch.drop_column(name)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    cols = {table: _columns(inspector, table) for table in ("workstreams", "signal_tags", "contacts") if table in tables}
    ws_cols = cols.get("workstreams", set())
    tag_cols = cols.get("signal_tags", set())

    saved = 0
    for table, column, where in _DROPPED:
        if column in cols.get(table, set()):
            saved += value_backups.backup_column(bind, revision, table, column, where)

    if "always_review" in ws_cols:
        strict = []
        if "autonomy_level" in ws_cols:
            strict.append(_STRICT_FLOW)
        if {"send_mode", "autonomy_level"} <= tag_cols:
            strict.append(
                "id IN (SELECT workstream_id FROM signal_tags "
                f"WHERE workstream_id IS NOT NULL AND {_STRICT_TAG})"
            )
        if strict:
            where = f"({' OR '.join(strict)}) AND NOT always_review"
            saved += value_backups.backup_column(bind, revision, "workstreams", "always_review", where)
            bind.execute(sa.text(f"UPDATE workstreams SET always_review = true WHERE {where}"))
    if {"send_mode", "autonomy_level"} <= tag_cols:
        count = bind.execute(
            sa.text(f"SELECT count(*) FROM signal_tags WHERE workstream_id IS NULL AND {_STRICT_TAG}")
        ).scalar()
        print(f"labels without a flow that lose their autonomy setting: {count}")
    print(f"values kept in {value_backups.TABLE}: {saved}")

    _drop("signal_tags", [c for c in ("send_mode", "autonomy_level") if c in tag_cols])
    _drop("workstreams", ["autonomy_level"] if "autonomy_level" in ws_cols else [])
    if "ai_handling" in cols.get("contacts", set()):
        _drop("contacts", ["ai_handling"])


def downgrade() -> None:
    op.add_column(
        "signal_tags",
        sa.Column("send_mode", sa.String(), nullable=False, server_default="send"),
    )
    op.add_column(
        "signal_tags",
        sa.Column("autonomy_level", sa.String(), nullable=False, server_default=""),
    )
    op.add_column(
        "workstreams",
        sa.Column("autonomy_level", sa.String(), nullable=False, server_default=""),
    )
    op.add_column("contacts", sa.Column("ai_handling", sa.String(), nullable=True))

    bind = op.get_bind()
    for table, column, _where in _DROPPED:
        value_backups.restore_column(bind, revision, table, column)
    value_backups.restore_column(bind, revision, "workstreams", "always_review")
    value_backups.clear(bind, revision)
