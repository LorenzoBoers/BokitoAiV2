"""Categories and tickets live on hashtags and conversations.

- ``signal_tags`` gains ``workstream_id`` (set = category), ``pinned``,
  ``show_in_nav`` and the category intake settings
- ``signals`` gains ``ticket_tag_id``, ``ticket_status``, ``stage_key``,
  ``ticket_certainty``, ``ticket_filed_at``
- ``workstream_projects`` attaches playbooks to projects (many-to-many)
- ``agent_runs`` / ``usage_ledger`` ``signal_type_id`` become ``ticket_tag_id``
- Case types become category hashtags, cases become conversation tickets
- Drops ``cases``, ``case_type_fields``, ``case_type_bindings``,
  ``case_types``, ``inbox_folders``, ``workstreams.project_id``,
  ``workstreams.is_default`` and ``work_jobs.case_id``

Revision ID: 075_tickets_on_conversations
Revises: 074_inbox_folders
"""

from __future__ import annotations

import re
import uuid
from collections import Counter
from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision = "075_tickets_on_conversations"
down_revision = "074_inbox_folders"
branch_labels = None
depends_on = None

MAX_TAG_LEN = 40
_SEPARATOR_RE = re.compile(r"[^\w]+", re.UNICODE)
_SEED_NAMES = {
    "complaint": "klacht",
    "bug_report": "storing",
    "spam_abuse": "spam",
    "feature_request": "functieverzoek",
    "invoice_payment": "factuur",
}


def _normalize(raw: object) -> str:
    if not isinstance(raw, str):
        return ""
    text = _SEPARATOR_RE.sub("-", raw.strip().lstrip("#").lower().replace("_", "-"))
    return text.strip("-")[:MAX_TAG_LEN].strip("-")


def _columns(inspector, table: str) -> set[str]:
    return {c["name"] for c in inspector.get_columns(table)}


def _add_columns(inspector, table: str, columns: list[sa.Column]) -> None:
    existing = _columns(inspector, table)
    missing = [c for c in columns if c.name not in existing]
    if not missing:
        return
    with op.batch_alter_table(table) as batch:
        for column in missing:
            batch.add_column(column)


def _ticket_status(case_status: str) -> str:
    if case_status in ("proposed", "open", "waiting", "done"):
        return case_status
    if case_status in ("closed", "resolved"):
        return "done"
    return ""


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    _add_columns(
        inspector,
        "signal_tags",
        [
            sa.Column("workstream_id", sa.Uuid(), sa.ForeignKey("workstreams.id"), nullable=True),
            sa.Column("pinned", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("show_in_nav", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("create_mode", sa.String(), nullable=False, server_default="ask_customer"),
            sa.Column("ask_threshold", sa.Integer(), nullable=False, server_default="6"),
            sa.Column("auto_threshold", sa.Integer(), nullable=False, server_default="9"),
            sa.Column("send_mode", sa.String(), nullable=False, server_default="draft"),
            sa.Column("autonomy_level", sa.String(), nullable=False, server_default="assisted"),
            sa.Column("requires_verification", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("module_slug", sa.String(), nullable=False, server_default=""),
            sa.Column("template_slug", sa.String(), nullable=False, server_default=""),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        ],
    )
    _add_columns(
        inspector,
        "signals",
        [
            sa.Column("ticket_tag_id", sa.Uuid(), sa.ForeignKey("signal_tags.id"), nullable=True),
            sa.Column("ticket_status", sa.String(), nullable=False, server_default=""),
            sa.Column("stage_key", sa.String(), nullable=False, server_default=""),
            sa.Column("ticket_certainty", sa.Integer(), nullable=True),
            sa.Column("ticket_filed_at", sa.DateTime(), nullable=True),
        ],
    )
    for table in ("agent_runs", "usage_ledger"):
        _add_columns(
            inspector,
            table,
            [sa.Column("ticket_tag_id", sa.Uuid(), sa.ForeignKey("signal_tags.id"), nullable=True)],
        )
    inspector = sa.inspect(bind)
    existing_indexes = {i["name"] for i in inspector.get_indexes("signals")}
    if "ix_signals_ticket_tag_id" not in existing_indexes:
        op.create_index("ix_signals_ticket_tag_id", "signals", ["ticket_tag_id"])
    if "ix_signals_ticket_status" not in existing_indexes:
        op.create_index("ix_signals_ticket_status", "signals", ["ticket_status"])
    if "ix_signal_tags_workstream_id" not in {i["name"] for i in inspector.get_indexes("signal_tags")}:
        op.create_index("ix_signal_tags_workstream_id", "signal_tags", ["workstream_id"])
    if not inspector.has_table("workstream_projects"):
        op.create_table(
            "workstream_projects",
            sa.Column("workstream_id", sa.Uuid(), sa.ForeignKey("workstreams.id"), primary_key=True),
            sa.Column("project_id", sa.Uuid(), sa.ForeignKey("projects.id"), primary_key=True),
            sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
            sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_workstream_projects_tenant_id", "workstream_projects", ["tenant_id"])
        op.create_index("ix_workstream_projects_project_id", "workstream_projects", ["project_id"])

    _migrate_data(bind)

    inspector = sa.inspect(bind)
    for table, column in (
        ("work_jobs", "case_id"),
        ("agent_runs", "signal_type_id"),
        ("usage_ledger", "signal_type_id"),
        ("workstreams", "project_id"),
        ("workstreams", "is_default"),
    ):
        if column in _columns(inspector, table):
            with op.batch_alter_table(table) as batch:
                batch.drop_column(column)
    for table in ("cases", "case_type_fields", "case_type_bindings", "case_types", "inbox_folders"):
        if inspector.has_table(table):
            op.drop_table(table)


def _migrate_data(bind) -> None:
    inspector = sa.inspect(bind)
    now = datetime.utcnow()
    tags = sa.table(
        "signal_tags",
        sa.column("id", sa.Uuid()), sa.column("tenant_id", sa.Uuid()), sa.column("name", sa.String()),
        sa.column("description", sa.String()), sa.column("workstream_id", sa.Uuid()),
        sa.column("show_in_nav", sa.Boolean()), sa.column("create_mode", sa.String()),
        sa.column("ask_threshold", sa.Integer()), sa.column("auto_threshold", sa.Integer()),
        sa.column("send_mode", sa.String()), sa.column("autonomy_level", sa.String()),
        sa.column("requires_verification", sa.Boolean()), sa.column("module_slug", sa.String()),
        sa.column("template_slug", sa.String()), sa.column("sort_order", sa.Integer()),
        sa.column("created_at", sa.DateTime()), sa.column("updated_at", sa.DateTime()),
    )
    links = sa.table(
        "signal_tag_links", sa.column("signal_id", sa.Uuid()), sa.column("tag_id", sa.Uuid()),
        sa.column("tenant_id", sa.Uuid()), sa.column("created_at", sa.DateTime()),
    )
    ws_projects = sa.table(
        "workstream_projects", sa.column("workstream_id", sa.Uuid()), sa.column("project_id", sa.Uuid()),
        sa.column("tenant_id", sa.Uuid()), sa.column("is_default", sa.Boolean()),
        sa.column("position", sa.Integer()), sa.column("created_at", sa.DateTime()),
    )

    def add_link(signal_id, tag_id, tenant_id) -> None:
        exists = bind.execute(
            sa.select(links.c.signal_id).where(links.c.signal_id == signal_id, links.c.tag_id == tag_id)
        ).first()
        if not exists:
            bind.execute(links.insert().values(signal_id=signal_id, tag_id=tag_id, tenant_id=tenant_id, created_at=now))

    def attach(ws_id, project_id, tenant_id, is_default: bool) -> None:
        exists = bind.execute(
            sa.select(ws_projects.c.workstream_id).where(
                ws_projects.c.workstream_id == ws_id, ws_projects.c.project_id == project_id
            )
        ).first()
        if not exists:
            bind.execute(
                ws_projects.insert().values(
                    workstream_id=ws_id, project_id=project_id, tenant_id=tenant_id,
                    is_default=is_default, position=0, created_at=now,
                )
            )

    # Tag names follow the hashtag rules; duplicates after normalizing merge.
    by_name: dict[tuple[str, str], uuid.UUID] = {}
    for row in bind.execute(sa.text("SELECT id, tenant_id, name FROM signal_tags ORDER BY created_at")).all():
        clean = _normalize(row.name) or "tag"
        key = (str(row.tenant_id), clean)
        target = by_name.get(key)
        if target is not None:
            bind.execute(
                sa.text(
                    "INSERT INTO signal_tag_links (signal_id, tag_id, tenant_id, created_at) "
                    "SELECT signal_id, :target, tenant_id, created_at FROM signal_tag_links "
                    "WHERE tag_id = :source ON CONFLICT DO NOTHING"
                ),
                {"source": row.id, "target": target},
            )
            bind.execute(sa.text("DELETE FROM signal_tag_links WHERE tag_id = :source"), {"source": row.id})
            bind.execute(sa.text("DELETE FROM signal_tags WHERE id = :source"), {"source": row.id})
            continue
        by_name[key] = row.id
        if clean != row.name:
            bind.execute(tags.update().where(tags.c.id == row.id).values(name=clean))

    ws_columns = _columns(inspector, "workstreams")
    if "project_id" in ws_columns:
        default_col = ", is_default" if "is_default" in ws_columns else ""
        for row in bind.execute(
            sa.text(f"SELECT id, tenant_id, project_id{default_col} FROM workstreams WHERE project_id IS NOT NULL")
        ).mappings():
            attach(row["id"], row["project_id"], row["tenant_id"], bool(row.get("is_default")))

    if not inspector.has_table("case_types"):
        return
    case_types = bind.execute(
        sa.text("SELECT * FROM case_types WHERE deleted_at IS NULL ORDER BY sort_order")
    ).mappings().all()
    playbook_by_type: dict[str, uuid.UUID] = {}
    if inspector.has_table("case_type_bindings"):
        for row in bind.execute(
            sa.text(
                "SELECT case_type_id, target_id FROM case_type_bindings "
                "WHERE target_kind = 'workstream' AND enabled ORDER BY priority"
            )
        ).mappings():
            playbook_by_type.setdefault(str(row["case_type_id"]), row["target_id"])
    case_rows = (
        bind.execute(sa.text("SELECT * FROM cases ORDER BY created_at")).mappings().all()
        if inspector.has_table("cases")
        else []
    )
    for (type_id, ws_id), _ in Counter(
        (str(row["case_type_id"]), row["workstream_id"]) for row in case_rows if row["workstream_id"]
    ).most_common():
        playbook_by_type.setdefault(type_id, ws_id)

    tag_by_type: dict[str, uuid.UUID] = {}
    for ct in case_types:
        name = _SEED_NAMES.get(ct["slug"]) or _normalize(ct["name"]) or _normalize(ct["slug"])
        key = (str(ct["tenant_id"]), name)
        tag_id = by_name.get(key)
        if tag_id is None:
            tag_id = uuid.uuid4()
            bind.execute(
                tags.insert().values(
                    id=tag_id, tenant_id=ct["tenant_id"], name=name, description=ct["description"] or "",
                    created_at=now, updated_at=now,
                )
            )
            by_name[key] = tag_id
        playbook = playbook_by_type.get(str(ct["id"]))
        values = {
            "create_mode": ct["create_mode"] or "ask_customer",
            "ask_threshold": ct["ask_threshold"] if ct["ask_threshold"] is not None else 6,
            "auto_threshold": ct["auto_threshold"] if ct["auto_threshold"] is not None else 9,
            "send_mode": ct.get("send_mode") or "draft",
            "autonomy_level": ct.get("autonomy_level") or "assisted",
            "requires_verification": bool(ct["requires_verification"]),
            "module_slug": ct["module_slug"] or "",
            "template_slug": ct["template_slug"] or "",
            "sort_order": ct["sort_order"] or 0,
        }
        if playbook is not None:
            values["workstream_id"] = playbook
            values["show_in_nav"] = True
            if ct.get("default_project_id"):
                attach(playbook, uuid.UUID(str(ct["default_project_id"])), ct["tenant_id"], False)
        bind.execute(tags.update().where(tags.c.id == tag_id).values(**values))
        tag_by_type[str(ct["id"])] = tag_id

    filed: set[str] = set()
    for case in reversed(case_rows):
        tag_id = tag_by_type.get(str(case["case_type_id"]))
        if tag_id is None:
            continue
        status = _ticket_status(case["status"] or "")
        signal_key = str(case["signal_id"])
        if str(case["case_type_id"]) not in playbook_by_type or not status or signal_key in filed:
            add_link(case["signal_id"], tag_id, case["tenant_id"])
            continue
        filed.add(signal_key)
        bind.execute(
            sa.text(
                "UPDATE signals SET ticket_tag_id = :tid, ticket_status = :status, stage_key = :stage, "
                "ticket_certainty = :certainty, ticket_filed_at = :filed, "
                "project_id = COALESCE(:project, project_id) WHERE id = :sid"
            ),
            {
                "tid": tag_id, "status": status, "stage": case.get("stage_key") or "",
                "certainty": case["certainty"], "filed": case["created_at"],
                "project": case["project_id"], "sid": case["signal_id"],
            },
        )
        if case["workstream_run_id"]:
            bind.execute(
                sa.text(
                    "UPDATE workstream_runs SET input_kind = 'ticket', input_ref = :ref, signal_id = :sid "
                    "WHERE id = :run"
                ),
                {"ref": signal_key, "sid": case["signal_id"], "run": case["workstream_run_id"]},
            )

    for table in ("agent_runs", "usage_ledger"):
        if "signal_type_id" in _columns(inspector, table):
            for type_id, tag_id in tag_by_type.items():
                bind.execute(
                    sa.text(f"UPDATE {table} SET ticket_tag_id = :tag WHERE signal_type_id = :type"),
                    {"tag": tag_id, "type": uuid.UUID(type_id)},
                )
    if inspector.has_table("trash_entries"):
        bind.execute(
            sa.text("DELETE FROM trash_entries WHERE resource_type IN ('case_type', 'case_type_binding')")
        )
    bind.execute(
        sa.text(
            "UPDATE platform_changes SET status = 'rejected' "
            "WHERE resource_type IN ('case_type', 'case_type_binding') AND status IN ('draft', 'pending_review')"
        )
    )


def downgrade() -> None:
    raise NotImplementedError("075 moves cases onto conversations and cannot be reversed.")
