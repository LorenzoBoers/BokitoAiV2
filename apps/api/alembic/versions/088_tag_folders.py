"""Tags as folders.

- ``tag_groups``: dimensions of tags (Relatie, Documenttype, ...), optionally exclusive.
- ``signal_tags.group_id``; ``pinned`` folds into ``show_in_nav``; the name is
  unique per tenant (duplicates merge into the oldest row).
- ``projects.tag_id`` (the folder's tag) and ``projects.child_group_id`` (a
  group folder with one virtual child per tag). Every living project gets a
  tag from its slug; conversations already inside a project get that path's
  tags so the derived folder equals the stored one.
- ``contact_tag_links`` and ``company_tag_links``.

Revision ID: 088_tag_folders
Revises: 087_project_parent
"""

from __future__ import annotations

import re
import uuid
from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision = "088_tag_folders"
down_revision = "087_project_parent"
branch_labels = None
depends_on = None

_SEPARATOR_RE = re.compile(r"[^\w]+", re.UNICODE)


def _normalize_tag(raw: str) -> str:
    text = _SEPARATOR_RE.sub("-", (raw or "").strip().lstrip("#").lower().replace("_", "-"))
    return text.strip("-")[:40].strip("-")


def _columns(inspector, table: str) -> set[str]:
    if table not in inspector.get_table_names():
        return set()
    return {c["name"] for c in inspector.get_columns(table)}


def _indexes(inspector, table: str) -> set[str]:
    if table not in inspector.get_table_names():
        return set()
    return {i["name"] for i in inspector.get_indexes(table)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("tag_groups"):
        op.create_table(
            "tag_groups",
            sa.Column("id", sa.Uuid(), primary_key=True),
            sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
            sa.Column("name", sa.String(), nullable=False, server_default=""),
            sa.Column("slug", sa.String(), nullable=False, server_default=""),
            sa.Column("description", sa.String(), nullable=False, server_default=""),
            sa.Column("exclusive", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("tenant_id", "slug", name="uq_tag_groups_tenant_slug"),
        )
        op.create_index("ix_tag_groups_tenant_id", "tag_groups", ["tenant_id"])
        op.create_index("ix_tag_groups_slug", "tag_groups", ["slug"])

    inspector = sa.inspect(bind)
    tag_columns = _columns(inspector, "signal_tags")
    if "group_id" not in tag_columns:
        with op.batch_alter_table("signal_tags") as batch:
            batch.add_column(sa.Column("group_id", sa.Uuid(), nullable=True))
            batch.create_foreign_key("fk_signal_tags_group_id", "tag_groups", ["group_id"], ["id"], ondelete="SET NULL")
        op.create_index("ix_signal_tags_group_id", "signal_tags", ["group_id"])

    project_columns = _columns(inspector, "projects")
    if "tag_id" not in project_columns or "child_group_id" not in project_columns:
        with op.batch_alter_table("projects") as batch:
            if "tag_id" not in project_columns:
                batch.add_column(sa.Column("tag_id", sa.Uuid(), nullable=True))
                batch.create_foreign_key("fk_projects_tag_id", "signal_tags", ["tag_id"], ["id"], ondelete="SET NULL")
            if "child_group_id" not in project_columns:
                batch.add_column(sa.Column("child_group_id", sa.Uuid(), nullable=True))
                batch.create_foreign_key(
                    "fk_projects_child_group_id", "tag_groups", ["child_group_id"], ["id"], ondelete="SET NULL"
                )
        indexes = _indexes(sa.inspect(bind), "projects")
        if "ix_projects_tag_id" not in indexes:
            op.create_index("ix_projects_tag_id", "projects", ["tag_id"])
        if "ix_projects_child_group_id" not in indexes:
            op.create_index("ix_projects_child_group_id", "projects", ["child_group_id"])

    for table, owner in (("contact_tag_links", "contacts"), ("company_tag_links", "companies")):
        if not inspector.has_table(table):
            owner_col = "contact_id" if owner == "contacts" else "company_id"
            op.create_table(
                table,
                sa.Column(owner_col, sa.Uuid(), sa.ForeignKey(f"{owner}.id"), primary_key=True),
                sa.Column("tag_id", sa.Uuid(), sa.ForeignKey("signal_tags.id"), primary_key=True),
                sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id"), nullable=False),
                sa.Column("created_at", sa.DateTime(), nullable=False),
            )
            op.create_index(f"ix_{table}_tenant_id", table, ["tenant_id"])
            op.create_index(f"ix_{table}_tag_id", table, ["tag_id"])

    _migrate_data(bind, pinned_column="pinned" in tag_columns)

    inspector = sa.inspect(bind)
    if "pinned" in _columns(inspector, "signal_tags"):
        with op.batch_alter_table("signal_tags") as batch:
            batch.drop_column("pinned")
    indexes = _indexes(sa.inspect(bind), "signal_tags")
    if "uq_signal_tags_tenant_name" not in indexes:
        op.create_index("uq_signal_tags_tenant_name", "signal_tags", ["tenant_id", "name"], unique=True)
    indexes = _indexes(sa.inspect(bind), "projects")
    if "uq_projects_parent_tag" not in indexes:
        op.create_index(
            "uq_projects_parent_tag",
            "projects",
            ["tenant_id", "parent_id", "tag_id"],
            unique=True,
            postgresql_where=sa.text("parent_id IS NOT NULL AND tag_id IS NOT NULL AND deleted_at IS NULL"),
            sqlite_where=sa.text("parent_id IS NOT NULL AND tag_id IS NOT NULL AND deleted_at IS NULL"),
        )
    if "uq_projects_root_tag" not in indexes:
        op.create_index(
            "uq_projects_root_tag",
            "projects",
            ["tenant_id", "tag_id"],
            unique=True,
            postgresql_where=sa.text("parent_id IS NULL AND tag_id IS NOT NULL AND deleted_at IS NULL"),
            sqlite_where=sa.text("parent_id IS NULL AND tag_id IS NOT NULL AND deleted_at IS NULL"),
        )


def _migrate_data(bind, *, pinned_column: bool) -> None:
    now = datetime.utcnow()
    tag_cols = [
        sa.column("id", sa.Uuid()),
        sa.column("tenant_id", sa.Uuid()),
        sa.column("name", sa.String()),
        sa.column("workstream_id", sa.Uuid()),
        sa.column("show_in_nav", sa.Boolean()),
        sa.column("description", sa.String()),
        sa.column("ai_auto_tag", sa.Boolean()),
        sa.column("create_mode", sa.String()),
        sa.column("ask_threshold", sa.Integer()),
        sa.column("auto_threshold", sa.Integer()),
        sa.column("send_mode", sa.String()),
        sa.column("autonomy_level", sa.String()),
        sa.column("requires_verification", sa.Boolean()),
        sa.column("module_slug", sa.String()),
        sa.column("template_slug", sa.String()),
        sa.column("sort_order", sa.Integer()),
        sa.column("created_at", sa.DateTime()),
        sa.column("updated_at", sa.DateTime()),
    ]
    if pinned_column:
        tag_cols.append(sa.column("pinned", sa.Boolean()))
    tags = sa.table("signal_tags", *tag_cols)
    links = sa.table(
        "signal_tag_links",
        sa.column("signal_id", sa.Uuid()),
        sa.column("tag_id", sa.Uuid()),
        sa.column("tenant_id", sa.Uuid()),
        sa.column("created_at", sa.DateTime()),
    )
    signals = sa.table(
        "signals",
        sa.column("id", sa.Uuid()),
        sa.column("tenant_id", sa.Uuid()),
        sa.column("project_id", sa.Uuid()),
        sa.column("ticket_tag_id", sa.Uuid()),
        sa.column("deleted_at", sa.DateTime()),
    )
    projects = sa.table(
        "projects",
        sa.column("id", sa.Uuid()),
        sa.column("tenant_id", sa.Uuid()),
        sa.column("name", sa.String()),
        sa.column("slug", sa.String()),
        sa.column("parent_id", sa.Uuid()),
        sa.column("tag_id", sa.Uuid()),
        sa.column("deleted_at", sa.DateTime()),
    )

    # 1. pinned free tags become workspace-default rail rows.
    if pinned_column:
        bind.execute(tags.update().where(tags.c.pinned.is_(True)).values(show_in_nav=True))

    # 2. Duplicate names per tenant merge into the oldest row.
    rows = bind.execute(
        sa.select(tags.c.id, tags.c.tenant_id, tags.c.name, tags.c.workstream_id, tags.c.created_at).order_by(
            tags.c.created_at, tags.c.id
        )
    ).all()
    keep: dict[tuple, object] = {}
    for row in rows:
        key = (row.tenant_id, row.name)
        if key not in keep:
            keep[key] = row
            continue
        target = keep[key]
        if target.workstream_id is None and row.workstream_id is not None:
            # Prefer the action tag as survivor; swap roles.
            keep[key], target, row = row, row, target
        tagged = {
            r[0]
            for r in bind.execute(sa.select(links.c.signal_id).where(links.c.tag_id == target.id)).all()
        }
        for link in bind.execute(sa.select(links.c.signal_id, links.c.tenant_id).where(links.c.tag_id == row.id)).all():
            if link.signal_id not in tagged:
                bind.execute(
                    links.insert().values(
                        signal_id=link.signal_id, tag_id=target.id, tenant_id=link.tenant_id, created_at=now
                    )
                )
        bind.execute(links.delete().where(links.c.tag_id == row.id))
        bind.execute(
            signals.update().where(signals.c.ticket_tag_id == row.id).values(ticket_tag_id=target.id)
        )
        bind.execute(projects.update().where(projects.c.tag_id == row.id).values(tag_id=target.id))
        bind.execute(tags.delete().where(tags.c.id == row.id))

    # 3. Every living project gets a tag (from its slug) when it has none.
    by_name: dict[tuple, object] = {}
    for row in bind.execute(sa.select(tags.c.id, tags.c.tenant_id, tags.c.name)).all():
        by_name[(row.tenant_id, row.name)] = row.id
    project_rows = bind.execute(
        sa.select(projects.c.id, projects.c.tenant_id, projects.c.name, projects.c.slug, projects.c.parent_id, projects.c.tag_id).where(
            projects.c.deleted_at.is_(None)
        )
    ).all()
    tag_of: dict = {}
    parent_of: dict = {}
    for project in project_rows:
        parent_of[project.id] = project.parent_id
        if project.tag_id is not None:
            tag_of[project.id] = project.tag_id
            continue
        name = _normalize_tag(project.slug or project.name) or _normalize_tag(str(project.id)[:8])
        tag_id = by_name.get((project.tenant_id, name))
        if tag_id is None:
            tag_id = uuid.uuid4()
            legacy = {"pinned": False} if pinned_column else {}
            bind.execute(
                tags.insert().values(
                    **legacy,
                    id=tag_id,
                    tenant_id=project.tenant_id,
                    name=name,
                    description="",
                    workstream_id=None,
                    show_in_nav=False,
                    ai_auto_tag=True,
                    create_mode="ask_customer",
                    ask_threshold=6,
                    auto_threshold=9,
                    send_mode="send",
                    autonomy_level="",
                    requires_verification=False,
                    module_slug="",
                    template_slug="",
                    sort_order=0,
                    created_at=now,
                    updated_at=now,
                )
            )
            by_name[(project.tenant_id, name)] = tag_id
        bind.execute(projects.update().where(projects.c.id == project.id).values(tag_id=tag_id))
        tag_of[project.id] = tag_id

    # 4. Conversations inside a project carry that path's tags.
    def path_tags(project_id) -> list:
        out: list = []
        seen: set = set()
        current = project_id
        while current is not None and current not in seen and current in tag_of:
            seen.add(current)
            out.append(tag_of[current])
            current = parent_of.get(current)
        return out

    filed = bind.execute(
        sa.select(signals.c.id, signals.c.tenant_id, signals.c.project_id).where(signals.c.project_id.is_not(None))
    ).all()
    for signal in filed:
        wanted = path_tags(signal.project_id)
        if not wanted:
            continue
        have = {
            r[0]
            for r in bind.execute(sa.select(links.c.tag_id).where(links.c.signal_id == signal.id)).all()
        }
        for tag_id in wanted:
            if tag_id in have:
                continue
            bind.execute(
                links.insert().values(signal_id=signal.id, tag_id=tag_id, tenant_id=signal.tenant_id, created_at=now)
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    for name in ("uq_projects_root_tag", "uq_projects_parent_tag", "ix_projects_child_group_id", "ix_projects_tag_id"):
        if name in _indexes(inspector, "projects"):
            op.drop_index(name, table_name="projects")
    if "uq_signal_tags_tenant_name" in _indexes(inspector, "signal_tags"):
        op.drop_index("uq_signal_tags_tenant_name", table_name="signal_tags")
    for table in ("company_tag_links", "contact_tag_links"):
        if inspector.has_table(table):
            op.drop_table(table)
    if "pinned" not in _columns(inspector, "signal_tags"):
        with op.batch_alter_table("signal_tags") as batch:
            batch.add_column(sa.Column("pinned", sa.Boolean(), nullable=False, server_default=sa.false()))
    project_columns = _columns(inspector, "projects")
    with op.batch_alter_table("projects") as batch:
        if "child_group_id" in project_columns:
            batch.drop_constraint("fk_projects_child_group_id", type_="foreignkey")
            batch.drop_column("child_group_id")
        if "tag_id" in project_columns:
            batch.drop_constraint("fk_projects_tag_id", type_="foreignkey")
            batch.drop_column("tag_id")
    if "group_id" in _columns(inspector, "signal_tags"):
        if "ix_signal_tags_group_id" in _indexes(inspector, "signal_tags"):
            op.drop_index("ix_signal_tags_group_id", table_name="signal_tags")
        with op.batch_alter_table("signal_tags") as batch:
            batch.drop_constraint("fk_signal_tags_group_id", type_="foreignkey")
            batch.drop_column("group_id")
    if inspector.has_table("tag_groups"):
        op.drop_table("tag_groups")
