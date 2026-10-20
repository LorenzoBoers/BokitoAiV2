"""Flow stages live only in stages_json, with the right names.

Revision ID: 125_stage_source
Revises: 124_one_autonomy

1. A stage of kind waiting is called "Wachtend" (NL) or "Waiting" (EN); the
   other kinds keep the names from 121. A numbered name follows its alias
   ("Active 2" becomes "Wachtend 2"). Of several stages with one canonical
   name, those without tickets and without settings are dropped, and the first
   one left carries the bare name.
2. A flow with no valid stages gets the named default pipeline.
3. workstream_stages and workstream_stage_owners are dropped.

The old stages_json of every changed flow and every row of both tables go to
schema_value_backups first; the downgrade puts them back.
"""

from __future__ import annotations

import json
import re

import sqlalchemy as sa
from alembic import op

from app.db import value_backups

revision = "125_stage_source"
down_revision = "124_one_autonomy"
branch_labels = None
depends_on = None

_KINDS = ("open", "waiting", "done", "closed")
_CANON = {
    "en": {"open": "Not started", "waiting": "Waiting", "done": "Done"},
    "nl": {"open": "Niet gestart", "waiting": "Wachtend", "done": "Klaar"},
}
_ALIASES = {
    "open": {"open", "not started", "niet gestart"},
    "waiting": {"waiting", "active", "actief", "wachtend", "wacht"},
    "done": {"done", "klaar"},
}
_SUFFIX = re.compile(r"^(.*?)\s+(\d+)$")


def _language(settings_json: str | None) -> str:
    try:
        data = json.loads(settings_json or "{}")
    except json.JSONDecodeError:
        data = {}
    lang = ""
    if isinstance(data, dict):
        lang = str(data.get("ai_workspace_language") or data.get("ui_language") or "")
    return "nl" if lang.lower().startswith("nl") else "en"


def _split(name: str) -> tuple[str, str]:
    match = _SUFFIX.match(name.strip())
    if match:
        return match.group(1).strip(), match.group(2)
    return name.strip(), ""


def _canonical(kind: str, name: str, language: str) -> tuple[str, str] | None:
    """(canonical base, suffix) when the name is a kind alias.

    A generated name of another kind ("Active 2" on a done stage) takes the
    name of the stage's own kind.
    """
    if kind not in _ALIASES:
        return None
    base, suffix = _split(name)
    lowered = base.lower()
    if not any(lowered in aliases for aliases in _ALIASES.values()):
        return None
    return _CANON[language][kind], suffix if lowered in _ALIASES[kind] else ""


def _configured(stage: dict) -> bool:
    return bool(
        stage.get("fields")
        or stage.get("owner")
        or stage.get("checkup_minutes")
        or stage.get("auto_close_conversation")
    )


def _defaults(language: str) -> list[dict]:
    return [
        {
            "key": kind,
            "name": _CANON[language][kind],
            "kind": kind,
            "auto_close_conversation": False,
            "fields": [],
            "owner": None,
            "checkup_minutes": 0,
        }
        for kind in ("open", "waiting", "done")
    ]


def normalize_stages(stages: object, language: str, used_keys: set[str]) -> list[dict] | None:
    """New stages list, or None when nothing changes."""
    if not isinstance(stages, list) or not any(
        isinstance(s, dict) and str(s.get("key") or "").strip() and s.get("kind") in _KINDS for s in stages
    ):
        return _defaults(language)

    changed = False
    renamed: list[dict] = []
    groups: dict[str, list[int]] = {}
    for stage in stages:
        if not isinstance(stage, dict):
            renamed.append(stage)
            continue
        kind = str(stage.get("kind") or "")
        name = str(stage.get("name") or "")
        canon = _canonical(kind, name, language)
        if canon is None:
            renamed.append(stage)
            continue
        base, suffix = canon
        target = f"{base} {suffix}" if suffix else base
        if target != name:
            stage = {**stage, "name": target}
            changed = True
        groups.setdefault(f"{kind}:{base}", []).append(len(renamed))
        renamed.append(stage)

    drop: set[int] = set()
    for members in groups.values():
        keep = [
            i for i in members
            if str(renamed[i].get("key") or "") in used_keys or _configured(renamed[i])
        ] or members[:1]
        drop.update(i for i in members if i not in keep)
        first = renamed[keep[0]]
        base, _ = _split(str(first.get("name") or ""))
        if not any(renamed[i].get("name") == base for i in keep):
            renamed[keep[0]] = {**first, "name": base}
            changed = True
    if drop:
        changed = True
    out = [stage for i, stage in enumerate(renamed) if i not in drop]
    return out if changed else None


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())
    if "workstreams" in tables:
        tenants = {
            row[0]: _language(row[1])
            for row in bind.execute(sa.text("SELECT id, settings_json FROM tenants"))
        }
        rows = bind.execute(sa.text("SELECT id, tenant_id, stages_json FROM workstreams")).fetchall()
        for ws_id, tenant_id, raw in rows:
            try:
                stages = json.loads(raw or "[]")
            except json.JSONDecodeError:
                stages = []
            used_keys = {
                str(row[0])
                for row in bind.execute(
                    sa.text(
                        "SELECT DISTINCT stage_key FROM signals WHERE stage_key IS NOT NULL AND ticket_tag_id IN "
                        "(SELECT id FROM signal_tags WHERE workstream_id = :ws)"
                    ),
                    {"ws": ws_id},
                )
            }
            new = normalize_stages(stages, tenants.get(tenant_id, "en"), used_keys)
            if new is not None:
                value_backups.backup_column(
                    bind, revision, "workstreams", "stages_json", f"CAST(id AS TEXT) = '{ws_id}'"
                )
                bind.execute(
                    sa.text("UPDATE workstreams SET stages_json = :raw WHERE id = :id"),
                    {"raw": json.dumps(new), "id": ws_id},
                )
    if "workstream_stage_owners" in tables:
        value_backups.backup_rows(bind, revision, "workstream_stage_owners")
        op.drop_table("workstream_stage_owners")
    if "workstream_stages" in tables:
        value_backups.backup_rows(bind, revision, "workstream_stages")
        op.drop_table("workstream_stages")


def downgrade() -> None:
    op.create_table(
        "workstream_stages",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("workstream_id", sa.Uuid(), sa.ForeignKey("workstreams.id"), nullable=False),
        sa.Column("key", sa.String(64), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("checkup_minutes", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_workstream_stages_tenant_id", "workstream_stages", ["tenant_id"])
    op.create_index("ix_workstream_stages_workstream_id", "workstream_stages", ["workstream_id"])
    op.create_table(
        "workstream_stage_owners",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("stage_id", sa.Uuid(), sa.ForeignKey("workstream_stages.id"), nullable=False),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id")),
        sa.Column("agent_id", sa.Uuid(), sa.ForeignKey("agents.id")),
        sa.Column("department_id", sa.Uuid(), sa.ForeignKey("departments.id")),
        sa.Column("created_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_workstream_stage_owners_stage_id", "workstream_stage_owners", ["stage_id"])
    op.create_index("ix_workstream_stage_owners_tenant_id", "workstream_stage_owners", ["tenant_id"])

    bind = op.get_bind()
    value_backups.restore_rows(bind, revision, "workstream_stages")
    value_backups.restore_rows(bind, revision, "workstream_stage_owners")
    value_backups.restore_column(bind, revision, "workstreams", "stages_json")
    value_backups.clear(bind, revision)
