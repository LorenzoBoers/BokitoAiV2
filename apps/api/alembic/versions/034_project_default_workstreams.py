"""Seed a default workstream for every project that has none.

Phase 4 of the workstream rebuild: agent edits to project docs run
exclusively through workstream runs, so every project needs at least one
runnable workstream. New projects get it at creation; this migration covers
the existing rows (one "Review and execute" workstream with a single agent
step, marked is_default).

Revision ID: 034_project_default_workstreams
Revises: 033_workstreams_rebuild
"""

import uuid
from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision = "034_project_default_workstreams"
down_revision = "033_workstreams_rebuild"
branch_labels = None
depends_on = None

DEFAULT_NAME = "Review and execute"
DEFAULT_DESCRIPTION = (
    "Default project workstream: assess the input, update the project "
    "documentation, and execute what is needed."
)
DEFAULT_STEP_GOAL = (
    "Assess the run input against the project documentation. Link the queue "
    "item to the documents it touches (link_queue_item_to_doc), update the "
    "affected sections with write_doc (pass `section` to edit one `##` "
    "section; keep sections at one topic, roughly 150-400 words), and execute "
    "what the input asks for. Finish with a concise report of what changed "
    "and why."
)


def upgrade() -> None:
    bind = op.get_bind()
    now = datetime.utcnow()

    projects = bind.execute(
        sa.text("SELECT id, tenant_id FROM projects")
    ).fetchall()
    for project_id, tenant_id in projects:
        existing = bind.execute(
            sa.text(
                "SELECT id, is_default FROM workstreams "
                "WHERE project_id = :pid AND tenant_id = :tid"
            ),
            {"pid": project_id, "tid": tenant_id},
        ).fetchall()
        if existing:
            if not any(row[1] for row in existing):
                bind.execute(
                    sa.text("UPDATE workstreams SET is_default = true WHERE id = :id"),
                    {"id": existing[0][0]},
                )
            continue
        ws_id = str(uuid.uuid4())
        bind.execute(
            sa.text(
                "INSERT INTO workstreams "
                "(id, tenant_id, project_id, name, description, enabled, "
                " is_default, created_at, updated_at) "
                "VALUES (:id, :tid, :pid, :name, :description, true, true, "
                " :now, :now)"
            ),
            {
                "id": ws_id,
                "tid": tenant_id,
                "pid": project_id,
                "name": DEFAULT_NAME,
                "description": DEFAULT_DESCRIPTION,
                "now": now,
            },
        )
        bind.execute(
            sa.text(
                "INSERT INTO workstream_steps "
                "(id, tenant_id, workstream_id, position, name, kind, goal, "
                " agent_role, wait_kind, deadline_hours, on_deadline, "
                " knowledge_section_ids_json, config_json, created_at) "
                "VALUES (:id, :tid, :wid, 0, 'Assess and execute', 'agent', "
                " :goal, '', 'input', 0, 'continue', '[]', '{}', :now)"
            ),
            {
                "id": str(uuid.uuid4()),
                "tid": tenant_id,
                "wid": ws_id,
                "goal": DEFAULT_STEP_GOAL,
                "now": now,
            },
        )


def downgrade() -> None:
    bind = op.get_bind()
    ws_ids = bind.execute(
        sa.text(
            "SELECT id FROM workstreams WHERE name = :name AND is_default = true"
        ),
        {"name": DEFAULT_NAME},
    ).fetchall()
    for (ws_id,) in ws_ids:
        bind.execute(
            sa.text("DELETE FROM workstream_steps WHERE workstream_id = :id"),
            {"id": ws_id},
        )
        bind.execute(sa.text("DELETE FROM workstreams WHERE id = :id"), {"id": ws_id})
