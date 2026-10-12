"""Hashtag words join with underscores.

Rewrites ``signal_tags.name`` (space / hyphen / underscore → ``_``), merges
rows that collide, points links / tickets / contact / company / folder tags
at the survivor, and aligns living folder names with their tag. Open
``Which folder?`` cards are deferred: home is derived, never asked.

Revision ID: 090_tag_underscore
Revises: 089_canvas_signal
"""

from __future__ import annotations

import re
from datetime import datetime

import sqlalchemy as sa
from alembic import op

revision = "090_tag_underscore"
down_revision = "089_canvas_signal"
branch_labels = None
depends_on = None

_SEPARATOR_RE = re.compile(r"[^\w]+", re.UNICODE)


def _normalize_tag(raw: str) -> str:
    text = (raw or "").strip().lstrip("#").lower().replace("-", "_")
    text = _SEPARATOR_RE.sub("_", text)
    text = re.sub(r"_+", "_", text)
    return text.strip("_")[:40].strip("_")


def upgrade() -> None:
    bind = op.get_bind()
    now = datetime.utcnow()
    inspector = sa.inspect(bind)
    tag_cols = [sa.column("id", sa.Uuid()), sa.column("tenant_id", sa.Uuid()), sa.column("name", sa.String())]
    if "workstream_id" in {c["name"] for c in inspector.get_columns("signal_tags")}:
        tag_cols.append(sa.column("workstream_id", sa.Uuid()))
    if "created_at" in {c["name"] for c in inspector.get_columns("signal_tags")}:
        tag_cols.append(sa.column("created_at", sa.DateTime()))
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
        sa.column("ticket_tag_id", sa.Uuid()),
    )
    projects = sa.table(
        "projects",
        sa.column("id", sa.Uuid()),
        sa.column("tag_id", sa.Uuid()),
        sa.column("name", sa.String()),
        sa.column("slug", sa.String()),
        sa.column("deleted_at", sa.DateTime()),
        sa.column("updated_at", sa.DateTime()),
    )
    contact_links = sa.table(
        "contact_tag_links",
        sa.column("contact_id", sa.Uuid()),
        sa.column("tag_id", sa.Uuid()),
        sa.column("tenant_id", sa.Uuid()),
        sa.column("created_at", sa.DateTime()),
    )
    company_links = sa.table(
        "company_tag_links",
        sa.column("company_id", sa.Uuid()),
        sa.column("tag_id", sa.Uuid()),
        sa.column("tenant_id", sa.Uuid()),
        sa.column("created_at", sa.DateTime()),
    )

    rows = bind.execute(
        sa.select(*tag_cols).order_by(
            tags.c.created_at if any(c.name == "created_at" for c in tag_cols) else tags.c.id,
            tags.c.id,
        )
    ).all()

    keep: dict[tuple, object] = {}
    for row in rows:
        clean = _normalize_tag(row.name) or "tag"
        key = (row.tenant_id, clean)
        if key not in keep:
            keep[key] = row
            continue
        target = keep[key]
        source = row
        if getattr(target, "workstream_id", None) is None and getattr(row, "workstream_id", None) is not None:
            keep[key] = row
            target, source = row, target
        _merge_tag(bind, links, signals, projects, contact_links, company_links, tags, now, source.id, target.id)

    for survivor in keep.values():
        clean = _normalize_tag(survivor.name) or "tag"
        if clean != survivor.name:
            bind.execute(tags.update().where(tags.c.id == survivor.id).values(name=clean))

    for row in bind.execute(sa.select(projects.c.id, projects.c.tag_id).where(projects.c.deleted_at.is_(None))).all():
        if row.tag_id is None:
            continue
        tag = bind.execute(sa.select(tags.c.name).where(tags.c.id == row.tag_id)).first()
        if tag is None or not tag.name:
            continue
        bind.execute(
            projects.update()
            .where(projects.c.id == row.id)
            .values(name=tag.name, slug=tag.name, updated_at=now)
        )

    if inspector.has_table("decision_requests"):
        decisions = sa.table(
            "decision_requests",
            sa.column("source_type", sa.String()),
            sa.column("status", sa.String()),
            sa.column("chosen_option_id", sa.String()),
            sa.column("resolved_at", sa.DateTime()),
        )
        bind.execute(
            decisions.update()
            .where(decisions.c.source_type == "folder", decisions.c.status == "awaiting_human")
            .values(status="deferred", chosen_option_id="dismissed", resolved_at=now)
        )


def _merge_tag(bind, links, signals, projects, contact_links, company_links, tags, now, source_id, target_id) -> None:
    tagged = {r[0] for r in bind.execute(sa.select(links.c.signal_id).where(links.c.tag_id == target_id)).all()}
    for link in bind.execute(
        sa.select(links.c.signal_id, links.c.tenant_id).where(links.c.tag_id == source_id)
    ).all():
        if link.signal_id not in tagged:
            bind.execute(
                links.insert().values(
                    signal_id=link.signal_id, tag_id=target_id, tenant_id=link.tenant_id, created_at=now
                )
            )
    bind.execute(links.delete().where(links.c.tag_id == source_id))
    bind.execute(signals.update().where(signals.c.ticket_tag_id == source_id).values(ticket_tag_id=target_id))
    bind.execute(projects.update().where(projects.c.tag_id == source_id).values(tag_id=target_id))
    _merge_owner_links(bind, contact_links, "contact_id", now, source_id, target_id)
    _merge_owner_links(bind, company_links, "company_id", now, source_id, target_id)
    bind.execute(tags.delete().where(tags.c.id == source_id))


def _merge_owner_links(bind, table, owner_col: str, now, source_id, target_id) -> None:
    owner = getattr(table.c, owner_col)
    have = {r[0] for r in bind.execute(sa.select(owner).where(table.c.tag_id == target_id)).all()}
    for link in bind.execute(sa.select(owner, table.c.tenant_id, table.c.created_at).where(table.c.tag_id == source_id)).all():
        if getattr(link, owner_col) not in have:
            bind.execute(
                table.insert().values(
                    **{
                        owner_col: getattr(link, owner_col),
                        "tag_id": target_id,
                        "tenant_id": link.tenant_id,
                        "created_at": now,
                    }
                )
            )
    bind.execute(table.delete().where(table.c.tag_id == source_id))


def downgrade() -> None:
    pass
