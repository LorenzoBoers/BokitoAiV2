"""Normalize flow stage titles to the workspace language.

Revision ID: 121_flow_stage_names
Revises: 120_participant_unread

Keys stay put so tickets keep their stage. Only the display name changes,
and a numbered duplicate with no tickets is dropped.
"""

from __future__ import annotations

import json

import sqlalchemy as sa
from alembic import op

revision = "121_flow_stage_names"
down_revision = "120_participant_unread"
branch_labels = None
depends_on = None

_CANON = {
    "en": {"open": "Not started", "waiting": "Active", "done": "Done"},
    "nl": {"open": "Niet gestart", "waiting": "Actief", "done": "Klaar"},
}
_ALIASES = {
    "open": {"open", "not started", "niet gestart"},
    "waiting": {"waiting", "active", "actief"},
    "done": {"done", "klaar"},
}


def _language(settings_json: str | None) -> str:
    try:
        data = json.loads(settings_json or "{}")
    except json.JSONDecodeError:
        data = {}
    lang = ""
    if isinstance(data, dict):
        lang = str(data.get("ai_workspace_language") or data.get("ui_language") or "")
    return "nl" if lang.lower().startswith("nl") else "en"


def _canonical(kind: str, name: str, language: str) -> str | None:
    aliases = _ALIASES.get(kind)
    if not aliases:
        return None
    bare = name.strip()
    lowered = bare.lower()
    suffix = ""
    if lowered.endswith(tuple(f" {n}" for n in range(2, 10))):
        suffix = " " + lowered.rsplit(" ", 1)[1]
        lowered = lowered.rsplit(" ", 1)[0]
    if lowered not in aliases:
        return None
    return _CANON[language][kind] + suffix


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "workstreams" not in inspector.get_table_names():
        return
    tenants = {
        row[0]: _language(row[1])
        for row in bind.execute(sa.text("SELECT id, settings_json FROM tenants"))
    }
    rows = bind.execute(sa.text("SELECT id, tenant_id, stages_json FROM workstreams")).fetchall()
    for ws_id, tenant_id, raw in rows:
        try:
            stages = json.loads(raw or "[]")
        except json.JSONDecodeError:
            continue
        if not isinstance(stages, list):
            continue
        language = tenants.get(tenant_id, "en")
        used_keys = {
            row[0]
            for row in bind.execute(
                sa.text("SELECT stage_key FROM signals WHERE ticket_tag_id IN (SELECT id FROM signal_tags WHERE workstream_id = :ws)"),
                {"ws": ws_id},
            )
        }
        seen_names: set[str] = set()
        kept = []
        changed = False
        for stage in stages:
            if not isinstance(stage, dict):
                kept.append(stage)
                continue
            name = str(stage.get("name") or "")
            kind = str(stage.get("kind") or "")
            renamed = _canonical(kind, name, language)
            if renamed and renamed != name:
                stage = {**stage, "name": renamed}
                changed = True
                name = renamed
            key = str(stage.get("key") or "")
            if name.lower() in seen_names and key not in used_keys:
                changed = True
                continue
            seen_names.add(name.lower())
            kept.append(stage)
        if changed:
            bind.execute(
                sa.text("UPDATE workstreams SET stages_json = :raw WHERE id = :id"),
                {"raw": json.dumps(kept), "id": ws_id},
            )


def downgrade() -> None:
    pass
