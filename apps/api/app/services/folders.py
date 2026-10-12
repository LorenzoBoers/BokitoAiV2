"""Folders are tags with a place; a conversation's folder follows from its tags.

A `Project` row is a folder. A *tag folder* carries ``tag_id`` and contributes
that tag to the path of everything inside it. A *group folder* carries
``child_group_id``: it shows one virtual child per tag in that group, and its
static children apply under each of those virtual children (the template
mechanism, without copying rows). A virtual child becomes a row when someone
pins it ("Vastzetten").

`resolve` walks the tree with a conversation's effective tags (its own links,
its action tag, its contact's and company's tags) and returns the deepest
matching path. ``Signal.project_id`` caches the home: the deepest materialised
row, or on a tie the longest shared ancestor, else the current home when it
still matches. Lists filter on path tags, so a conversation can appear in
more than one folder. The home is never asked.

Every write that can change a conversation's tags or the tree calls `refile`
so the cache never drifts from the rule.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Iterable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.channel import Contact
from app.models.project import Project
from app.models.signal import (
    CompanyTagLink,
    ContactTagLink,
    Signal,
    SignalEvent,
    SignalTag,
    SignalTagLink,
    TagGroup,
)

FOLDER_DECISION_SOURCE = "folder"
MAX_DEPTH = 16


# ---------------------------------------------------------------------------
# Tree


@dataclass
class FolderNode:
    id: UUID
    name: str
    slug: str
    parent_id: UUID | None
    tag_id: UUID | None
    child_group_id: UUID | None


@dataclass
class PathSegment:
    """One step on a folder path: a row (``project_id``) or a virtual child (``tag_id`` only)."""

    name: str
    tag_id: UUID | None
    project_id: UUID | None

    @property
    def virtual(self) -> bool:
        return self.project_id is None


@dataclass
class FolderPath:
    segments: list[PathSegment] = field(default_factory=list)

    @property
    def depth(self) -> int:
        return len(self.segments)

    @property
    def project_id(self) -> UUID | None:
        """Deepest materialised row on the path."""
        for segment in reversed(self.segments):
            if segment.project_id is not None:
                return segment.project_id
        return None

    @property
    def tag_ids(self) -> list[UUID]:
        return [s.tag_id for s in self.segments if s.tag_id is not None]

    @property
    def virtual_tag_ids(self) -> list[UUID]:
        """Tags of the virtual segments after the deepest row (the list filter)."""
        out: list[UUID] = []
        for segment in reversed(self.segments):
            if segment.project_id is not None:
                break
            if segment.tag_id is not None:
                out.append(segment.tag_id)
        out.reverse()
        return out

    @property
    def label(self) -> str:
        return " / ".join(s.name for s in self.segments)

    def key(self) -> tuple:
        return tuple((s.project_id, s.tag_id) for s in self.segments)

    def to_dict(self) -> dict[str, Any]:
        return {
            "project_id": str(self.project_id) if self.project_id else None,
            "label": self.label,
            "segments": [
                {
                    "name": s.name,
                    "tag_id": str(s.tag_id) if s.tag_id else None,
                    "project_id": str(s.project_id) if s.project_id else None,
                }
                for s in self.segments
            ],
        }


@dataclass
class Placement:
    path: FolderPath | None
    candidates: list[FolderPath]

    @property
    def ambiguous(self) -> bool:
        return len(self.candidates) > 1

    @property
    def project_id(self) -> UUID | None:
        return self.path.project_id if self.path else None


@dataclass
class FolderTree:
    tenant_id: UUID
    nodes: dict[UUID, FolderNode]
    tags: dict[UUID, SignalTag]
    groups: dict[UUID, TagGroup]

    def __post_init__(self) -> None:
        self.children: dict[UUID | None, list[FolderNode]] = {}
        for node in self.nodes.values():
            parent = node.parent_id if node.parent_id in self.nodes else None
            self.children.setdefault(parent, []).append(node)
        for rows in self.children.values():
            rows.sort(key=lambda n: n.name.lower())
        self.tags_by_group: dict[UUID, set[UUID]] = {}
        for tag in self.tags.values():
            if tag.group_id is not None:
                self.tags_by_group.setdefault(tag.group_id, set()).add(tag.id)

    # -- lookups -----------------------------------------------------------

    def roots(self) -> list[FolderNode]:
        return self.children.get(None, [])

    def tag_name(self, tag_id: UUID | None) -> str:
        tag = self.tags.get(tag_id) if tag_id else None
        return tag.name if tag else ""

    def static_path(self, project_id: UUID) -> FolderPath:
        """Path of rows from the root down to ``project_id`` (no virtual segments)."""
        chain: list[FolderNode] = []
        current = self.nodes.get(project_id)
        seen: set[UUID] = set()
        while current is not None and current.id not in seen and len(chain) <= MAX_DEPTH:
            seen.add(current.id)
            chain.append(current)
            current = self.nodes.get(current.parent_id) if current.parent_id else None
        chain.reverse()
        return FolderPath([PathSegment(n.name, n.tag_id, n.id) for n in chain])

    def path_tag_ids(self, project_id: UUID, virtual_tag_ids: Iterable[UUID] = ()) -> list[UUID]:
        """Tags a conversation needs to land on this row (plus a virtual remainder)."""
        out = self.static_path(project_id).tag_ids
        for tag_id in virtual_tag_ids:
            if tag_id in self.tags and tag_id not in out:
                out.append(tag_id)
        return out

    def subtree_ids(self, root_id: UUID) -> list[UUID]:
        out: list[UUID] = []
        stack = [root_id]
        seen: set[UUID] = set()
        while stack:
            current = stack.pop()
            if current in seen or current not in self.nodes:
                continue
            seen.add(current)
            out.append(current)
            stack.extend(child.id for child in self.children.get(current, []))
        return out

    def group_of_parent(self, node: FolderNode) -> UUID | None:
        """The group whose tags are virtual siblings of ``node`` (its parent's child group)."""
        parent = self.nodes.get(node.parent_id) if node.parent_id else None
        return parent.child_group_id if parent else None

    # -- resolution --------------------------------------------------------

    def matching_paths(self, tag_ids: Iterable[UUID]) -> list[FolderPath]:
        """Every path whose tags are all present (not only the deepest)."""
        present = {t for t in tag_ids if t in self.tags}
        found: list[FolderPath] = []

        def record(segments: list[PathSegment]) -> None:
            path = FolderPath(list(segments))
            if path.key() not in {p.key() for p in found}:
                found.append(path)

        def descend(node: FolderNode, segments: list[PathSegment], inherited: list[FolderNode]) -> None:
            if len(segments) > MAX_DEPTH:
                return
            static = self.children.get(node.id, [])
            if node.child_group_id is not None:
                group_tags = self.tags_by_group.get(node.child_group_id, set())
                by_tag = {c.tag_id: c for c in static if c.tag_id in group_tags}
                template = [c for c in static if c.tag_id not in group_tags]
                for tag_id in sorted(group_tags & present, key=lambda t: self.tag_name(t)):
                    child = by_tag.get(tag_id)
                    if child is not None:
                        next_segments = [*segments, PathSegment(child.name, child.tag_id, child.id)]
                        record(next_segments)
                        descend(child, next_segments, template)
                    else:
                        next_segments = [*segments, PathSegment(self.tag_name(tag_id), tag_id, None)]
                        record(next_segments)
                        for leaf in template:
                            if leaf.tag_id is not None and leaf.tag_id in present:
                                leaf_segments = [*next_segments, PathSegment(leaf.name, leaf.tag_id, leaf.id)]
                                record(leaf_segments)
                                descend(leaf, leaf_segments, [])
                return
            for child in [*static, *inherited]:
                if child.tag_id is not None and child.tag_id in present:
                    next_segments = [*segments, PathSegment(child.name, child.tag_id, child.id)]
                    record(next_segments)
                    descend(child, next_segments, [])
                elif child.tag_id is None and child.child_group_id is not None:
                    descend(child, segments, [])

        for root in self.roots():
            if root.tag_id is not None:
                if root.tag_id in present:
                    segments = [PathSegment(root.name, root.tag_id, root.id)]
                    record(segments)
                    descend(root, segments, [])
            elif root.child_group_id is not None:
                descend(root, [], [])
        return found

    def resolve(self, tag_ids: Iterable[UUID]) -> Placement:
        """Deepest path whose tags are all present; ties land on the common ancestor."""
        paths = self.matching_paths(tag_ids)
        if not paths:
            return Placement(path=None, candidates=[])
        deepest = max(p.depth for p in paths)
        best = [p for p in paths if p.depth == deepest]
        if len(best) == 1:
            return Placement(path=best[0], candidates=best)
        prefix: list[PathSegment] = []
        for position in range(min(p.depth for p in best)):
            first = best[0].segments[position]
            same = all(
                p.segments[position].project_id == first.project_id
                and p.segments[position].tag_id == first.tag_id
                for p in best
            )
            if not same:
                break
            prefix.append(first)
        return Placement(path=FolderPath(prefix), candidates=best)

    def leaf_paths(self, tag_ids: Iterable[UUID]) -> list[FolderPath]:
        """Matching paths that are not a prefix of a deeper match."""
        paths = self.matching_paths(tag_ids)
        return [
            path
            for path in paths
            if not any(
                other.depth > path.depth and other.key()[: path.depth] == path.key() for other in paths
            )
        ]


def serialize_folder_paths(tree: FolderTree, tag_ids: Iterable[UUID]) -> list[dict[str, Any]]:
    """Thread-header chips: every leaf path the conversation matches."""
    out: list[dict[str, Any]] = []
    for path in tree.leaf_paths(tag_ids):
        payload = path.to_dict()
        payload["tags"] = [tree.tag_name(tag_id) for tag_id in path.tag_ids]
        out.append(payload)
    return out


async def load_tree(session: AsyncSession, tenant_id: UUID) -> FolderTree:
    projects = (
        await session.execute(
            select(Project).where(Project.tenant_id == tenant_id, Project.deleted_at.is_(None))
        )
    ).scalars().all()
    tags = (await session.execute(select(SignalTag).where(SignalTag.tenant_id == tenant_id))).scalars().all()
    groups = (await session.execute(select(TagGroup).where(TagGroup.tenant_id == tenant_id))).scalars().all()
    return FolderTree(
        tenant_id=tenant_id,
        nodes={
            p.id: FolderNode(
                id=p.id,
                name=p.name,
                slug=p.slug,
                parent_id=p.parent_id,
                tag_id=p.tag_id,
                child_group_id=p.child_group_id,
            )
            for p in projects
        },
        tags={t.id: t for t in tags},
        groups={g.id: g for g in groups},
    )


# ---------------------------------------------------------------------------
# Effective tags


async def contact_tag_ids(session: AsyncSession, contact_id: UUID | None) -> set[UUID]:
    """The contact's own tags plus its company's."""
    if contact_id is None:
        return set()
    out = set(
        (
            await session.execute(select(ContactTagLink.tag_id).where(ContactTagLink.contact_id == contact_id))
        ).scalars()
    )
    contact = await session.get(Contact, contact_id)
    if contact is not None and contact.company_id is not None:
        out |= set(
            (
                await session.execute(
                    select(CompanyTagLink.tag_id).where(CompanyTagLink.company_id == contact.company_id)
                )
            ).scalars()
        )
    return out


async def effective_tag_ids(session: AsyncSession, signal: Signal) -> set[UUID]:
    """Links, the action tag, and the primary contact's (and company's) tags."""
    out = set(
        (await session.execute(select(SignalTagLink.tag_id).where(SignalTagLink.signal_id == signal.id))).scalars()
    )
    if signal.ticket_tag_id is not None:
        out.add(signal.ticket_tag_id)
    out |= await contact_tag_ids(session, signal.contact_id)
    return out


async def inherited_tag_names(session: AsyncSession, signal: Signal) -> list[str]:
    """Names of the tags a conversation carries through its contact (shown as "via contact")."""
    ids = await contact_tag_ids(session, signal.contact_id)
    if not ids:
        return []
    rows = (await session.execute(select(SignalTag.name).where(SignalTag.id.in_(list(ids))).order_by(SignalTag.name))).scalars()
    return list(rows)


# ---------------------------------------------------------------------------
# Refile


async def resolve_signal(
    session: AsyncSession, signal: Signal, *, tree: FolderTree | None = None
) -> Placement:
    tree = tree or await load_tree(session, signal.tenant_id)
    return tree.resolve(await effective_tag_ids(session, signal))


def _home_project_id(placement: Placement, current_id: UUID | None) -> UUID | None:
    """Deepest path; a same-depth tie uses the shared ancestor, else the current home."""
    if not placement.candidates:
        return None
    if not placement.ambiguous:
        return placement.project_id
    if placement.path and placement.path.project_id:
        return placement.path.project_id
    if current_id and any(c.project_id == current_id for c in placement.candidates):
        return current_id
    return None


async def refile(
    session: AsyncSession,
    signal: Signal,
    *,
    tree: FolderTree | None = None,
    actor_type: str = "system",
    actor_id: str = "",
    ask_on_ambiguity: bool = False,
) -> Placement:
    """Recompute the conversation's home folder from its tags. Flushes, never commits.

    A changed folder is logged in the thread timeline. A tie between folders
    at the same depth parks the conversation on their common ancestor, or
    keeps the current home when that ancestor is empty and the home still
    matches. Leftover ``Which folder?`` cards are deferred.
    """
    tree = tree or await load_tree(session, signal.tenant_id)
    placement = tree.resolve(await effective_tag_ids(session, signal))
    new_id = _home_project_id(placement, signal.project_id)
    current = tree.nodes.get(signal.project_id) if signal.project_id else None
    if not placement.candidates and current is not None and current.tag_id is None:
        new_id = signal.project_id
    if new_id != signal.project_id:
        _set_folder(session, signal, new_id, placement.path, tree, actor_type=actor_type, actor_id=actor_id)
    await _defer_folder_decisions(session, signal)
    await session.flush()
    return placement


def _set_folder(
    session: AsyncSession,
    signal: Signal,
    new_id: UUID | None,
    path: FolderPath | None,
    tree: FolderTree,
    *,
    actor_type: str,
    actor_id: str,
) -> None:
    previous = signal.project_id
    signal.project_id = new_id
    signal.updated_at = datetime.utcnow()
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
                    "path": path.label if path else "",
                    "tags": [tree.tag_name(t) for t in (path.tag_ids if path else [])],
                }
            ),
        )
    )


async def refile_many(
    session: AsyncSession,
    tenant_id: UUID,
    signal_ids: Iterable[UUID],
    *,
    actor_type: str = "system",
    actor_id: str = "",
) -> int:
    """Refile a set of conversations with one tree load. Returns how many moved."""
    ids = list(dict.fromkeys(signal_ids))
    if not ids:
        return 0
    tree = await load_tree(session, tenant_id)
    moved = 0
    for signal_id in ids:
        signal = await session.get(Signal, signal_id)
        if signal is None or signal.tenant_id != tenant_id:
            continue
        before = signal.project_id
        await refile(session, signal, tree=tree, actor_type=actor_type, actor_id=actor_id)
        if signal.project_id != before:
            moved += 1
    return moved


async def refile_tagged(
    session: AsyncSession, tenant_id: UUID, tag_ids: Iterable[UUID], *, actor_type: str = "system", actor_id: str = ""
) -> int:
    """Refile every conversation that carries any of these tags (links, ticket, contact or company)."""
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
            select(Contact.id).where(Contact.tenant_id == tenant_id).where(
                (Contact.id.in_(contacts)) | (Contact.company_id.in_(companies))
            )
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
    session: AsyncSession, tenant_id: UUID, project_id: UUID, *, actor_type: str = "system", actor_id: str = ""
) -> int:
    """After a folder moved, was pinned or went to the Bin: refile what sits in it
    and what its path's tags could pull in."""
    tree = await load_tree(session, tenant_id)
    ids = tree.subtree_ids(project_id) if project_id in tree.nodes else [project_id]
    inside = (
        await session.execute(
            select(Signal.id).where(Signal.tenant_id == tenant_id, Signal.project_id.in_(ids), Signal.deleted_at.is_(None))
        )
    ).scalars()
    moved = await refile_many(session, tenant_id, list(inside), actor_type=actor_type, actor_id=actor_id)
    tag_ids = [tree.nodes[i].tag_id for i in ids if i in tree.nodes and tree.nodes[i].tag_id is not None]
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
) -> Placement:
    """"File in folder" is tagging: add the path's tags; ``None`` takes the
    conversation out of its current folder by dropping that folder's own tag."""
    from app.services.signal_tags import add_signal_tag_ids, remove_signal_tag_ids

    tree = await load_tree(session, signal.tenant_id)
    if project_id is None:
        if signal.project_id and signal.project_id in tree.nodes:
            own = tree.nodes[signal.project_id].tag_id
            if own is None:
                # Manual folder: leaving it is a direct move.
                _set_folder(session, signal, None, None, tree, actor_type=actor_type, actor_id=actor_id)
            placement = tree.resolve(await effective_tag_ids(session, signal))
            drop = [own] if own else []
            drop.extend(placement.path.virtual_tag_ids if placement.path else [])
            await remove_signal_tag_ids(session, signal.tenant_id, signal.id, drop)
        return await refile(session, signal, tree=tree, actor_type=actor_type, actor_id=actor_id)
    if project_id not in tree.nodes:
        raise LookupError("Folder not found")
    wanted = tree.path_tag_ids(project_id, virtual_tag_ids)
    await add_signal_tag_ids(session, signal.tenant_id, signal.id, wanted, user_id=user_id)
    placement = await refile(session, signal, tree=tree, actor_type=actor_type, actor_id=actor_id)
    if tree.nodes[project_id].tag_id is None and signal.project_id != project_id:
        # Manual folder (no tag): place the conversation there directly.
        path = tree.static_path(project_id)
        _set_folder(session, signal, project_id, path, tree, actor_type=actor_type, actor_id=actor_id)
        await session.flush()
        return Placement(path=path, candidates=[path])
    return placement


async def _defer_folder_decisions(session: AsyncSession, signal: Signal) -> None:
    from app.models.notification import DecisionRequest
    from app.services.signal_decisions import DISMISSED_OPTION_ID

    rows = list(
        (
            await session.execute(
                select(DecisionRequest).where(
                    DecisionRequest.signal_id == signal.id,
                    DecisionRequest.source_type == FOLDER_DECISION_SOURCE,
                    DecisionRequest.status == "awaiting_human",
                )
            )
        ).scalars()
    )
    if not rows:
        return
    now = datetime.utcnow()
    for row in rows:
        row.status = "deferred"
        row.chosen_option_id = DISMISSED_OPTION_ID
        row.resolved_at = now
        session.add(row)


async def _ask_which_folder(session: AsyncSession, signal: Signal, placement: Placement, tree: FolderTree) -> None:
    from app.models.notification import DecisionRequest
    from app.services.signal_decisions import create_decision

    # One card per distinct tie: the same candidates never ask twice, and an
    # open card is not duplicated by the next refile.
    tie_key = "|".join(sorted("/".join(str(t) for t in c.tag_ids) for c in placement.candidates))
    source_id = f"{signal.id}:{tie_key}"[:512]
    asked = (
        await session.execute(
            select(DecisionRequest.id).where(
                DecisionRequest.tenant_id == signal.tenant_id,
                DecisionRequest.signal_id == signal.id,
                DecisionRequest.source_type == FOLDER_DECISION_SOURCE,
                DecisionRequest.source_id == source_id,
            )
        )
    ).first()
    if asked is not None:
        return
    options: list[dict[str, Any]] = []
    for candidate in placement.candidates:
        options.append(
            {
                "id": f"path:{'/'.join(str(t) for t in candidate.tag_ids)}",
                "label": candidate.label,
                "action_type": "file_in_folder",
                "payload": {
                    "signal_id": str(signal.id),
                    "project_id": str(candidate.project_id) if candidate.project_id else None,
                    "tag_ids": [str(t) for t in candidate.virtual_tag_ids],
                    "keep_tag_ids": [str(t) for t in candidate.tag_ids],
                },
            }
        )
    options.append({"id": "reject", "label": "Leave it here", "action_type": "none", "payload": {}})
    names = ", ".join(f"#{tree.tag_name(t)}" for t in sorted({t for c in placement.candidates for t in c.tag_ids}, key=lambda t: tree.tag_name(t)))
    await create_decision(
        session,
        signal.tenant_id,
        title="Which folder?",
        summary=f"The tags {names} match more than one folder. Pick one; the other tag comes off.",
        options=options,
        signal_id=signal.id,
        source_type=FOLDER_DECISION_SOURCE,
        source_id=source_id,
    )


async def settle_folder_choice(
    session: AsyncSession, tenant_id: UUID, payload: dict[str, Any], *, user_id: UUID | None
) -> None:
    """Decision outcome: keep the chosen path's tags, drop the competing ones, refile."""
    from app.services.signal_tags import remove_signal_tag_ids

    signal = await session.get(Signal, UUID(str(payload.get("signal_id"))))
    if signal is None or signal.tenant_id != tenant_id:
        return
    tree = await load_tree(session, tenant_id)
    keep = {UUID(t) for t in payload.get("keep_tag_ids") or [] if t}
    placement = tree.resolve(await effective_tag_ids(session, signal))
    competing = {t for c in placement.candidates for t in c.tag_ids} - keep
    if competing:
        await remove_signal_tag_ids(session, tenant_id, signal.id, competing)
    await refile(
        session,
        signal,
        tree=tree,
        actor_type="user",
        actor_id=str(user_id or ""),
    )
