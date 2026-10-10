"""Owner routing: last human owner + composing lock on signals, owner on contacts.

Revision ID: 084_owner_routing
Revises: 083_user_first_last_name
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "084_owner_routing"
down_revision = "083_user_first_last_name"
branch_labels = None
depends_on = None


_SIGNAL_COLUMNS = (
    ("last_human_owner_kind", sa.Column("last_human_owner_kind", sa.String(), server_default="", nullable=False)),
    ("last_human_owner_user_id", sa.Column("last_human_owner_user_id", sa.Uuid(), nullable=True)),
    ("last_human_owner_team_id", sa.Column("last_human_owner_team_id", sa.Uuid(), nullable=True)),
    ("human_composing_until", sa.Column("human_composing_until", sa.DateTime(), nullable=True)),
)

_CONTACT_COLUMNS = (
    ("owner_kind", sa.Column("owner_kind", sa.String(), server_default="", nullable=False)),
    ("owner_user_id", sa.Column("owner_user_id", sa.Uuid(), nullable=True)),
    ("owner_team_id", sa.Column("owner_team_id", sa.Uuid(), nullable=True)),
)


def _add_columns(table: str, columns) -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if table not in inspector.get_table_names():
        return
    existing = {c["name"] for c in inspector.get_columns(table)}
    with op.batch_alter_table(table) as batch:
        for name, column in columns:
            if name not in existing:
                batch.add_column(column)


def _drop_columns(table: str, columns) -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if table not in inspector.get_table_names():
        return
    existing = {c["name"] for c in inspector.get_columns(table)}
    with op.batch_alter_table(table) as batch:
        for name, _column in reversed(columns):
            if name in existing:
                batch.drop_column(name)


def upgrade() -> None:
    _add_columns("signals", _SIGNAL_COLUMNS)
    _add_columns("contacts", _CONTACT_COLUMNS)
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "contacts" in inspector.get_table_names():
        indexes = {i["name"] for i in inspector.get_indexes("contacts")}
        if "ix_contacts_owner_user_id" not in indexes:
            op.create_index("ix_contacts_owner_user_id", "contacts", ["owner_user_id"])
        if "ix_contacts_owner_team_id" not in indexes:
            op.create_index("ix_contacts_owner_team_id", "contacts", ["owner_team_id"])
    if "signals" in inspector.get_table_names():
        # Backfill: the current human owner is also the last human owner.
        bind.execute(
            sa.text(
                "UPDATE signals SET last_human_owner_kind = 'user', "
                "last_human_owner_user_id = assigned_user_id "
                "WHERE assignee_kind = 'user' AND assigned_user_id IS NOT NULL"
            )
        )
        bind.execute(
            sa.text(
                "UPDATE signals SET last_human_owner_kind = 'team', "
                "last_human_owner_team_id = assignee_team_id "
                "WHERE assignee_kind = 'team' AND assignee_team_id IS NOT NULL"
            )
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "contacts" in inspector.get_table_names():
        indexes = {i["name"] for i in inspector.get_indexes("contacts")}
        for name in ("ix_contacts_owner_team_id", "ix_contacts_owner_user_id"):
            if name in indexes:
                op.drop_index(name, table_name="contacts")
    _drop_columns("contacts", _CONTACT_COLUMNS)
    _drop_columns("signals", _SIGNAL_COLUMNS)
