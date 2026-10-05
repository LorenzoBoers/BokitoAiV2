"""Project canvas v2 — source + tree_json snapshot document.

Revision ID: 062_project_canvas_document
Revises: 061_agent_last_active_mock_mcp
"""

import json

import sqlalchemy as sa
from alembic import op

revision = "062_project_canvas_document"
down_revision = "061_agent_last_active_mock_mcp"
branch_labels = None
depends_on = None

_EMPTY_TREE = {"type": "Stack", "props": {}, "children": []}
_EMPTY_SOURCE = (
    'import { Stack } from "bokito/canvas"\n\n'
    "export default function Canvas() {\n"
    "  return <Stack />\n"
    "}\n"
)


def _legacy_intro(widgets_json: str | None) -> str | None:
    try:
        widgets = json.loads(widgets_json or "[]")
    except json.JSONDecodeError:
        return None
    if not isinstance(widgets, list):
        return None
    for widget in widgets:
        if not isinstance(widget, dict):
            continue
        wtype = str(widget.get("type") or "").lower()
        cfg = widget.get("config") if isinstance(widget.get("config"), dict) else {}
        if wtype not in {"markdown", "intro", "text", "note"}:
            continue
        for key in ("content", "markdown", "text", "body"):
            raw = cfg.get(key) or widget.get(key)
            if isinstance(raw, str) and raw.strip():
                return raw.strip()[:8000]
    return None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "project_canvases" not in set(inspector.get_table_names()):
        return
    cols = {c["name"] for c in inspector.get_columns("project_canvases")}
    if "source" not in cols:
        op.add_column(
            "project_canvases",
            sa.Column("source", sa.Text(), nullable=False, server_default=""),
        )
    if "tree_json" not in cols:
        op.add_column(
            "project_canvases",
            sa.Column("tree_json", sa.Text(), nullable=False, server_default="{}"),
        )

    rows = bind.execute(sa.text("SELECT id, widgets_json FROM project_canvases")).mappings()
    for row in rows:
        intro = _legacy_intro(row["widgets_json"])
        if intro:
            tree = {
                "type": "Stack",
                "props": {},
                "children": [{"type": "Text", "props": {"text": intro}, "children": []}],
            }
            source = (
                'import { Stack, Text } from "bokito/canvas"\n\n'
                "export default function Canvas() {\n"
                "  return (\n"
                "    <Stack>\n"
                f'      <Text text="{intro.replace(chr(34), chr(39))[:4000]}" />\n'
                "    </Stack>\n"
                "  )\n"
                "}\n"
            )
        else:
            tree = _EMPTY_TREE
            source = _EMPTY_SOURCE
        bind.execute(
            sa.text(
                "UPDATE project_canvases SET source = :source, tree_json = :tree, "
                "schema_version = 2 WHERE id = :id"
            ),
            {"source": source, "tree": json.dumps(tree), "id": str(row["id"])},
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "project_canvases" not in set(inspector.get_table_names()):
        return
    cols = {c["name"] for c in inspector.get_columns("project_canvases")}
    if "tree_json" in cols:
        op.drop_column("project_canvases", "tree_json")
    if "source" in cols:
        op.drop_column("project_canvases", "source")
