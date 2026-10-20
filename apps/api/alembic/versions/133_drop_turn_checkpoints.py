"""Drop turn checkpoint rows: an open turn lives on the thread log now.

- Placeholder bubbles (``in_progress`` with "Working on this." / "Done." or no
  text) are deleted.
- Other rows lose ``in_progress``; running activity is marked failed.

Revision ID: 133_drop_turn_checkpoints
Revises: 132_agent_definition
"""

from __future__ import annotations

import json
from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision = "133_drop_turn_checkpoints"
down_revision = "132_agent_definition"
branch_labels = None
depends_on = None

_PLACEHOLDERS = {"", "Working on this.", "Done."}


def _seal(items: object) -> list:
    out = []
    if not isinstance(items, list):
        return out
    now = datetime.utcnow().isoformat() + "Z"
    for raw in items:
        if not isinstance(raw, dict):
            continue
        item = dict(raw)
        if item.get("status") == "running":
            item["status"] = "error"
            item["ended_at"] = item.get("ended_at") or now
        out.append(item)
    return out


def upgrade() -> None:
    bind = op.get_bind()
    rows = bind.execute(
        sa.text(
            "SELECT id, body_text, metadata_json FROM signal_messages "
            "WHERE metadata_json LIKE '%in_progress%'"
        )
    ).fetchall()
    for row_id, body, raw in rows:
        try:
            meta = json.loads(raw or "{}")
        except (TypeError, ValueError):
            continue
        if not isinstance(meta, dict) or not meta.get("in_progress"):
            continue
        if (body or "").strip() in _PLACEHOLDERS and not meta.get("activity") and not meta.get("activity_after"):
            try:
                with bind.begin_nested():
                    bind.execute(sa.text("DELETE FROM signal_messages WHERE id = :id"), {"id": row_id})
                continue
            except sa.exc.IntegrityError:
                pass
        meta.pop("in_progress", None)
        meta["turn_failed"] = True
        meta["activity"] = _seal(meta.get("activity"))
        meta["activity_after"] = _seal(meta.get("activity_after"))
        bind.execute(
            sa.text("UPDATE signal_messages SET metadata_json = :meta WHERE id = :id"),
            {"meta": json.dumps(meta, default=str), "id": row_id},
        )


def downgrade() -> None:
    pass
