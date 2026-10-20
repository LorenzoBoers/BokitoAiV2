"""Module experts keep workspace basics: rewrite the hired "Stay inside this module" line.

Revision ID: 135_module_prompt_basics
Revises: 134_drop_decision_hints
"""

from __future__ import annotations

import re

import sqlalchemy as sa
from alembic import op

revision = "135_module_prompt_basics"
down_revision = "134_drop_decision_hints"
branch_labels = None
depends_on = None

_OLD = re.compile(r"Stay inside this module; hand other topics back to the lead with [^.]+\.")
_NEW = (
    "Workspace basics are yours too: folders, labels, contacts and conversations. "
    "Hand work that belongs to another module's expert back to the lead with handoff_to."
)


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text("SELECT id, system_prompt FROM agents WHERE system_prompt LIKE :pat"),
        {"pat": "%Stay inside this module;%"},
    ).all()
    for agent_id, prompt in rows:
        bind.execute(
            sa.text("UPDATE agents SET system_prompt = :p WHERE id = :id"),
            {"p": _OLD.sub(_NEW, prompt or ""), "id": agent_id},
        )


def downgrade() -> None:
    pass
