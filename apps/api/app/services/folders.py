"""Folders are named tree nodes with optional label (tag) filtersets.

A `Project` row is a folder hub. Tree shape is stored ``parent_id``. Labels live
in ``project_tag_links`` (AND). A conversation matches a folder when every label
in the set is present in its effective labels. ``Signal.project_id`` caches the
best match (most labels, then deepest in the tree). Filing applies that folder's
labels — nesting does not rewrite them.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Iterable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.time import utcnow
from app.models.channel import Contact
from app.models.project import Project, ProjectTagLink
from app.models.signal import (
    CompanyTagLink,
    ContactTagLink,
    Signal,
    SignalEvent,
    SignalTag,
    SignalTagLink,
)

FOLDER_DECISION_SOURCE = "folder"


@dataclass(frozen=True)
class FilterSet:
    """One folder: display name, optional parent, AND label set."""

    id: UUID
    name: str
    slug: str
    sort_order: int
    tag_ids: tuple[UUID, ...]
    tag_names: tuple[str, ...] = ()
    parent_id: UUID | None = None

    @property
    def tag_set(self) -> frozenset[UUID]:
        return frozenset(self.tag_ids)

    def matches(self, effective: Iterable[UUID]) -> bool:
        present = set(effective)
        return bool(self.tag_ids) and self.tag_set.issubset(present)

    def label(self) -> str:
        return self.name or (
            " · ".join(n for n in self.tag_names) if self.tag_names else "Folder"
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": str(self.id),
            "project_id": str(self.id),
            "name": self.name,
            "slug": self.slug,
            "sort_order": self.sort_order,
            "parent_id": str(self.parent_id) if self.parent_id else None,
            "tag_ids": [str(t) for t in self.tag_ids],
            "tag_names": list(self.tag_names),
            "label": self.label(),
        }


def _local_tag_names(
    tag_names: tuple[str, ...] | list[str],
    parent_tag_names: tuple[str, ...] | list[str] | None = None,
) -> list[str]:
    """Tags that distinguish this folder from its parent (layered nav / breadcrumbs)."""
    mine = [n for n in tag_names if n]
    if not parent_tag_names:
        return list(mine)
    parent = {n.lower() for n in parent_tag_names if n}
    local = [n for n in mine if n.lower() not in parent]
    return local or list(mine)


def folder_display_name(
    name: str,
    tag_names: tuple[str, ...] | list[str] = (),
    parent_tag_names: tuple[str, ...] | list[str] | None = None,
) -> str:
    """The one name a folder shows everywhere: its own name, else its distinguishing labels.

    A name that only lists the folder's own labels (the auto name ``a · b``)
    counts as unnamed. Empty when the folder has neither; the client renders
    its localized fallback.
    """
    raw = [p.strip() for p in (name or "").split("·") if p.strip().lstrip("#")]
    parts = [p.lstrip("#").strip() for p in raw]
    own = {n.lower() for n in tag_names if n}
    auto = bool(own) and all(p.startswith("#") for p in raw) and {p.lower() for p in parts} <= own
    if parts and not auto:
        return " · ".join(parts)
    return " · ".join(_local_tag_names(tag_names, parent_tag_names))


@dataclass
class DerivedNode:
    """A row in the derived tree: a real folder or a virtual cluster."""

    key: str
    name: str
    tag_ids: tuple[UUID, ...]
    project_id: UUID | None
    virtual: bool
    sort_order: int
    children: list[DerivedNode] = field(default_factory=list)
    tag_names: tuple[str, ...] = ()

    def to_nav_dict(self, *, count: int = 0, parent_id: str | None = None) -> dict[str, Any]:
        return {
            "id": str(self.project_id) if self.project_id else self.key,
            "name": self.name,
            "parent_id": parent_id,
            "project_id": str(self.project_id) if self.project_id else None,
            "tag_id": str(self.tag_ids[-1]) if self.tag_ids else None,
            "tag_ids": [str(t) for t in self.tag_ids],
            "tag_names": list(self.tag_names),
            "virtual": self.virtual,
            "count": count,
            "children": [
                c.to_nav_dict(
                    parent_id=str(self.project_id) if self.project_id else self.key
                )
                for c in self.children
            ],
        }


@dataclass
class FolderCatalog:
    """All filtersets for a tenant, with tag metadata for sorting."""

    tenant_id: UUID
    folders: list[FilterSet]
    tags: dict[UUID, SignalTag]

    def __post_init__(self) -> None:
        self.by_id: dict[UUID, FilterSet] = {f.id: f for f in self.folders}

    def tag_name(self, tag_id: UUID | None) -> str:
        if tag_id is None:
            return ""
        tag = self.tags.get(tag_id)
        return tag.name if tag else ""

    def sorted_tag_ids(self, tag_ids: Iterable[UUID]) -> list[UUID]:
        """Stable display order: label name, ascending."""
        unique = list(dict.fromkeys(tag_ids))
        unique.sort(key=lambda tid: self.tag_name(tid).lower())
        return unique


def matches(folder: FilterSet, effective: Iterable[UUID]) -> bool:
    return folder.matches(effective)


def matching_folders(catalog: FolderCatalog, effective: Iterable[UUID]) -> list[FilterSet]:
    present = set(effective)
    return [f for f in catalog.folders if f.matches(present)]


def _folder_depth(catalog: FolderCatalog, folder_id: UUID) -> int:
    depth = 0
    seen: set[UUID] = set()
    current: UUID | None = folder_id
    while current is not None and current not in seen:
        seen.add(current)
        folder = catalog.by_id.get(current)
        if folder is None or folder.parent_id is None:
            break
        depth += 1
        current = folder.parent_id
    return depth


def longest_match(catalog: FolderCatalog, effective: Iterable[UUID]) -> FilterSet | None:
    hits = matching_folders(catalog, effective)
    if not hits:
        return None
    hits.sort(
        key=lambda f: (
            -len(f.tag_ids),
            -_folder_depth(catalog, f.id),
            f.sort_order,
            f.name.lower(),
        )
    )
    return hits[0]


def derive_tree(catalog: FolderCatalog) -> list[DerivedNode]:
    """Build the nav tree from stored ``parent_id`` (free hierarchy)."""
    folders = list(catalog.folders)
    if not folders:
        return []

    known = {f.id for f in folders}
    children: dict[UUID | None, list[FilterSet]] = {}
    for folder in folders:
        parent = folder.parent_id if folder.parent_id in known else None
        children.setdefault(parent, []).append(folder)
    for rows in children.values():
        rows.sort(key=lambda f: (f.sort_order, f.name.lower()))

    def build(folder: FilterSet) -> DerivedNode:
        kids = [build(c) for c in children.get(folder.id, [])]
        return DerivedNode(
            key=str(folder.id),
            name=folder.name,
            tag_ids=folder.tag_ids,
            project_id=folder.id,
            virtual=False,
            sort_order=folder.sort_order,
            children=kids,
            tag_names=folder.tag_names,
        )

    return [build(root) for root in children.get(None, [])]


def folder_subtree_ids(catalog: FolderCatalog, root_id: UUID) -> list[UUID]:
    """``root_id`` plus every descendant via ``parent_id``."""
    children: dict[UUID | None, list[UUID]] = {}
    for folder in catalog.folders:
        children.setdefault(folder.parent_id, []).append(folder.id)
    out: list[UUID] = []
    stack = [root_id]
    seen: set[UUID] = set()
    while stack:
        current = stack.pop()
        if current in seen:
            continue
        seen.add(current)
        out.append(current)
        stack.extend(children.get(current, []))
    return out


def _cluster_siblings(nodes: list[DerivedNode], catalog: FolderCatalog) -> list[DerivedNode]:
    if len(nodes) < 2:
        return nodes
    # Group by intersection of tag sets when |intersection| >= 2 and each has extras.
    used: set[str] = set()
    out: list[DerivedNode] = []
    for i, a in enumerate(nodes):
        if a.key in used:
            continue
        group = [a]
        for b in nodes[i + 1 :]:
            if b.key in used:
                continue
            overlap = set(a.tag_ids) & set(b.tag_ids)
            if len(overlap) >= 2 and set(a.tag_ids) - overlap and set(b.tag_ids) - overlap:
                # Same overlap as a's first partner? require equal overlap set for the group.
                if set(group[0].tag_ids) & set(b.tag_ids) == overlap:
                    group.append(b)
        if len(group) >= 2:
            overlap_ids = tuple(catalog.sorted_tag_ids(set(group[0].tag_ids) & set(group[1].tag_ids)))
            names = [catalog.tag_name(t) for t in overlap_ids]
            for n in group:
                used.add(n.key)
            rewritten: list[DerivedNode] = []
            for member in group:
                local = _local_tag_names(member.tag_names, names)
                display = " · ".join(n for n in local) if local else member.name
                rewritten.append(
                    DerivedNode(
                        key=member.key,
                        name=display,
                        tag_ids=member.tag_ids,
                        project_id=member.project_id,
                        virtual=member.virtual,
                        sort_order=member.sort_order,
                        children=member.children,
                        tag_names=member.tag_names,
                    )
                )
            out.append(
                DerivedNode(
                    key="cluster:" + ",".join(str(t) for t in overlap_ids),
                    name=" · ".join(n for n in names if n),
                    tag_ids=overlap_ids,
                    project_id=None,
                    virtual=True,
                    sort_order=min(n.sort_order for n in group),
                    children=rewritten,
                    tag_names=tuple(n for n in names if n),
                )
            )
        else:
            used.add(a.key)
            out.append(a)
    out.sort(key=lambda n: (n.sort_order, n.name.lower()))
    return out


async def load_catalog(session: AsyncSession, tenant_id: UUID) -> FolderCatalog:
    projects = list(
        (
            await session.execute(
                select(Project).where(Project.tenant_id == tenant_id, Project.deleted_at.is_(None))
            )
        ).scalars()
    )
    links = list(
        (
            await session.execute(
                select(ProjectTagLink).where(ProjectTagLink.tenant_id == tenant_id)
            )
        ).scalars()
    )
    tags = {
        t.id: t
        for t in (
            await session.execute(select(SignalTag).where(SignalTag.tenant_id == tenant_id))
        ).scalars()
    }
    by_project: dict[UUID, list[ProjectTagLink]] = {}
    for link in links:
        by_project.setdefault(link.project_id, []).append(link)

    folders: list[FilterSet] = []
    catalog_proto = FolderCatalog(tenant_id=tenant_id, folders=[], tags=tags)
    for project in projects:
        rows = sorted(by_project.get(project.id, []), key=lambda r: (r.sort_order, str(r.tag_id)))
        tag_ids = catalog_proto.sorted_tag_ids([r.tag_id for r in rows])
        folders.append(
            FilterSet(
                id=project.id,
                name=project.name,
                slug=project.slug,
                sort_order=project.sort_order,
                tag_ids=tuple(tag_ids),
                tag_names=tuple(catalog_proto.tag_name(t) for t in tag_ids),
                parent_id=project.parent_id,
            )
        )
    folders.sort(key=lambda f: (f.sort_order, f.name.lower()))
    return FolderCatalog(tenant_id=tenant_id, folders=folders, tags=tags)


# Back-compat alias used by older call sites during the transition.
async def load_tree(session: AsyncSession, tenant_id: UUID) -> FolderCatalog:
    return await load_catalog(session, tenant_id)


def folder_path_label(folder: FilterSet) -> str:
    if folder.tag_names:
        return " / ".join(n for n in folder.tag_names)
    return folder.name


def folders_with_tag(catalog: FolderCatalog, tag_id: UUID) -> list[FilterSet]:
    hits = [f for f in catalog.folders if tag_id in f.tag_set]
    hits.sort(key=lambda f: (len(f.tag_ids), f.sort_order, f.name.lower()))
    return hits


def serialize_folders_for_tag(catalog: FolderCatalog, tag_id: UUID) -> list[dict[str, Any]]:
    return [
        {
            "id": str(f.id),
            "name": f.name,
            "path": folder_path_label(f),
            "tag_names": list(f.tag_names),
        }
        for f in folders_with_tag(catalog, tag_id)
    ]


def serialize_folder_paths(catalog: FolderCatalog, tag_ids: Iterable[UUID]) -> list[dict[str, Any]]:
    """Thread-header chips: every matching folder that is not a strict subset of another match."""
    hits = matching_folders(catalog, tag_ids)
    leaves = [
        f
        for f in hits
        if not any(f.tag_set < other.tag_set for other in hits if other.id != f.id)
    ]
    leaves.sort(key=lambda f: (-len(f.tag_ids), f.sort_order, f.name.lower()))
    return [f.to_dict() for f in leaves]


async def contact_tag_ids(session: AsyncSession, contact_id: UUID | None) -> set[UUID]:
    if contact_id is None:
        return set()
    out = set(
        (await session.execute(select(ContactTagLink.tag_id).where(ContactTagLink.contact_id == contact_id))).scalars()
    )
    contact = await session.get(Contact, contact_id)
    if contact and contact.company_id:
        out |= set(
            (
                await session.execute(
                    select(CompanyTagLink.tag_id).where(CompanyTagLink.company_id == contact.company_id)
                )
            ).scalars()
        )
    return out


async def effective_tag_ids(session: AsyncSession, signal: Signal) -> set[UUID]:
    out = set(
        (await session.execute(select(SignalTagLink.tag_id).where(SignalTagLink.signal_id == signal.id))).scalars()
    )
    if signal.ticket_tag_id is not None:
        out.add(signal.ticket_tag_id)
    out |= await contact_tag_ids(session, signal.contact_id)
    return out


async def inherited_tag_names(session: AsyncSession, signal: Signal) -> list[str]:
    ids = await contact_tag_ids(session, signal.contact_id)
    if not ids:
        return []
    rows = (
        await session.execute(select(SignalTag.name).where(SignalTag.id.in_(list(ids))).order_by(SignalTag.name))
    ).scalars()
    return list(rows)


async def folder_tag_ids(session: AsyncSession, project_id: UUID) -> list[UUID]:
    rows = (
        await session.execute(
            select(ProjectTagLink)
            .where(ProjectTagLink.project_id == project_id)
            .order_by(ProjectTagLink.sort_order, ProjectTagLink.tag_id)
        )
    ).scalars()
    return [r.tag_id for r in rows]


async def set_folder_tags(
    session: AsyncSession,
    tenant_id: UUID,
    project_id: UUID,
    tag_ids: Iterable[UUID],
) -> list[UUID]:
    """Replace the filterset. Returns the normalised tag id list."""
    wanted = list(dict.fromkeys(t for t in tag_ids if t))
    existing = list(
        (
            await session.execute(select(ProjectTagLink).where(ProjectTagLink.project_id == project_id))
        ).scalars()
    )
    for row in existing:
        await session.delete(row)
    await session.flush()
    for index, tag_id in enumerate(wanted):
        session.add(
            ProjectTagLink(
                project_id=project_id,
                tag_id=tag_id,
                tenant_id=tenant_id,
                sort_order=index,
            )
        )
    await session.flush()
    return wanted


async def refresh_home(
    session: AsyncSession,
    signal: Signal,
    *,
    catalog: FolderCatalog | None = None,
    actor_type: str = "system",
    actor_id: str = "",
) -> FilterSet | None:
    """Cache the longest matching folder on the signal. Flushes, never commits."""
    catalog = catalog or await load_catalog(session, signal.tenant_id)
    hit = longest_match(catalog, await effective_tag_ids(session, signal))
    new_id = hit.id if hit else None
    if new_id != signal.project_id:
        previous = signal.project_id
        signal.project_id = new_id
        signal.updated_at = utcnow()
        session.add(signal)
        session.add(
            SignalEvent(
                signal_id=signal.id,
                tenant_id=signal.tenant_id,
                event_type="folder_set",
                actor_type=actor_type or "system",
                actor_id=actor_id or "",
                payload_json=json.dumps(
                    {
                        "project_id": str(new_id) if new_id else None,
                        "previous": str(previous) if previous else None,
                        "path": hit.label() if hit else "",
                        "tags": list(hit.tag_names) if hit else [],
                    }
                ),
            )
        )
    await _defer_folder_decisions(session, signal)
    await session.flush()
    return hit


# Alias kept for call sites that still say refile.
async def refile(
    session: AsyncSession,
    signal: Signal,
    *,
    tree: FolderCatalog | None = None,
    catalog: FolderCatalog | None = None,
    actor_type: str = "system",
    actor_id: str = "",
    ask_on_ambiguity: bool = False,
) -> FilterSet | None:
    del ask_on_ambiguity
    return await refresh_home(
        session, signal, catalog=catalog or tree, actor_type=actor_type, actor_id=actor_id
    )


async def refile_many(
    session: AsyncSession,
    tenant_id: UUID,
    signal_ids: Iterable[UUID],
    *,
    actor_type: str = "system",
    actor_id: str = "",
) -> int:
    ids = list(dict.fromkeys(signal_ids))
    if not ids:
        return 0
    catalog = await load_catalog(session, tenant_id)
    moved = 0
    for signal_id in ids:
        signal = await session.get(Signal, signal_id)
        if signal is None or signal.tenant_id != tenant_id:
            continue
        before = signal.project_id
        await refresh_home(session, signal, catalog=catalog, actor_type=actor_type, actor_id=actor_id)
        if signal.project_id != before:
            moved += 1
    return moved


async def refile_tagged(
    session: AsyncSession,
    tenant_id: UUID,
    tag_ids: Iterable[UUID],
    *,
    actor_type: str = "system",
    actor_id: str = "",
) -> int:
    ids = [t for t in dict.fromkeys(tag_ids)]
    if not ids:
        return 0
    linked = select(SignalTagLink.signal_id).where(SignalTagLink.tag_id.in_(ids))
    filed = select(Signal.id).where(Signal.tenant_id == tenant_id, Signal.ticket_tag_id.in_(ids))
    contacts = select(ContactTagLink.contact_id).where(ContactTagLink.tag_id.in_(ids))
    companies = select(CompanyTagLink.company_id).where(CompanyTagLink.tag_id.in_(ids))
    via_contact = select(Signal.id).where(
        Signal.tenant_id == tenant_id,
        Signal.contact_id.in_(
            select(Contact.id)
            .where(Contact.tenant_id == tenant_id)
            .where((Contact.id.in_(contacts)) | (Contact.company_id.in_(companies)))
        ),
    )
    rows = await session.execute(
        select(Signal.id).where(
            Signal.tenant_id == tenant_id,
            Signal.deleted_at.is_(None),
            Signal.id.in_(linked.union(filed, via_contact)),
        )
    )
    return await refile_many(session, tenant_id, list(rows.scalars()), actor_type=actor_type, actor_id=actor_id)


async def refile_subtree(
    session: AsyncSession,
    tenant_id: UUID,
    project_id: UUID,
    *,
    actor_type: str = "system",
    actor_id: str = "",
) -> int:
    """After a filterset changes: refresh homes for matching and previously-homed threads."""
    tag_ids = await folder_tag_ids(session, project_id)
    inside = (
        await session.execute(
            select(Signal.id).where(
                Signal.tenant_id == tenant_id,
                Signal.project_id == project_id,
                Signal.deleted_at.is_(None),
            )
        )
    ).scalars()
    moved = await refile_many(session, tenant_id, list(inside), actor_type=actor_type, actor_id=actor_id)
    if tag_ids:
        moved += await refile_tagged(session, tenant_id, tag_ids, actor_type=actor_type, actor_id=actor_id)
    return moved


async def file_in_folder(
    session: AsyncSession,
    signal: Signal,
    project_id: UUID | None,
    *,
    virtual_tag_ids: Iterable[UUID] = (),
    user_id: UUID | None = None,
    actor_type: str = "user",
    actor_id: str = "",
) -> FilterSet | None:
    """Apply (or clear) a folder's tags on the conversation.

    Name-only folders have an empty tag set, so ``longest_match`` never homes
    them. Explicit filing still pins ``Signal.project_id`` so canvases and
    other thread-owned work show up in Works in.
    """
    from app.services.signal_tags import add_signal_tag_ids, remove_signal_tag_ids

    del virtual_tag_ids
    catalog = await load_catalog(session, signal.tenant_id)
    if project_id is None:
        if signal.project_id and signal.project_id in catalog.by_id:
            await remove_signal_tag_ids(
                session, signal.tenant_id, signal.id, list(catalog.by_id[signal.project_id].tag_ids)
            )
        return await refresh_home(session, signal, catalog=catalog, actor_type=actor_type, actor_id=actor_id)
    folder = catalog.by_id.get(project_id)
    if folder is None:
        raise LookupError("Folder not found")
    await add_signal_tag_ids(session, signal.tenant_id, signal.id, list(folder.tag_ids), user_id=user_id)
    hit = await refresh_home(session, signal, catalog=catalog, actor_type=actor_type, actor_id=actor_id)
    if signal.project_id is None:
        signal.project_id = project_id
        signal.updated_at = utcnow()
        session.add(signal)
        session.add(
            SignalEvent(
                signal_id=signal.id,
                tenant_id=signal.tenant_id,
                event_type="folder_set",
                actor_type=actor_type or "system",
                actor_id=actor_id or "",
                payload_json=json.dumps(
                    {
                        "project_id": str(project_id),
                        "previous": None,
                        "path": folder.label(),
                        "tags": list(folder.tag_names),
                        "explicit": True,
                    }
                ),
            )
        )
        await session.flush()
        return folder
    return hit


async def _defer_folder_decisions(session: AsyncSession, signal: Signal) -> None:
    from app.models.notification import DecisionRequest

    rows = (
        await session.execute(
            select(DecisionRequest).where(
                DecisionRequest.signal_id == signal.id,
                DecisionRequest.status == "awaiting_human",
                DecisionRequest.source_type == FOLDER_DECISION_SOURCE,
            )
        )
    ).scalars()
    now = utcnow()
    for row in rows:
        row.status = "deferred"
        row.resolved_at = now
        session.add(row)


# Legacy type aliases so imports of FolderTree / FolderPath keep working briefly.
FolderTree = FolderCatalog
FolderPath = FilterSet
FolderNode = FilterSet
