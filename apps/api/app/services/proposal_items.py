"""Display snapshots for chat showcase items (and decision proposals).

Agents pass light refs (``{"type": "project", "id": "..."}``); this module
resolves them once, inside the tenant, into a display snapshot. Snapshots can
live on any agent bubble (``metadata.items``) or on a decision card. Deleted
or renamed objects still render as proposed. Unresolved refs come back with
``missing: true``.
"""

from __future__ import annotations

import logging
import json
from typing import Any
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession


logger = logging.getLogger(__name__)

MAX_ITEMS = 10

ITEM_TYPES = (
    "conversation",
    "trash_entry",
    "trigger",
    "file",
    "image",
    "user",
    "agent",
    "tag",
    "flow",
    "folder",
    "project",
    "canvas",
    "contact",
    "integration",
    "marketplace",
    "module",
    "help_doc",
    "knowledge",
    "message",
)

_TYPE_ALIASES = {
    "signal": "conversation",
    "thread": "conversation",
    "trash": "trash_entry",
    "bin": "trash_entry",
    "agenda": "trigger",
    "agenda_item": "trigger",
    "attachment": "file",
    "member": "user",
    "workstream": "flow",
    "project": "folder",
    "hashtag": "tag",
    "connection": "integration",
    "provider": "marketplace",
    "connector": "marketplace",
    "koppeling": "marketplace",
    "docs": "help_doc",
    "article": "help_doc",
    "help": "help_doc",
    "document": "knowledge",
    "doc": "knowledge",
    "workspace_doc": "knowledge",
    "knowledge": "knowledge",
    "quote": "message",
    "img": "image",
    "picture": "image",
    "photo": "image",
}

# Pending showcase items from attach_items, keyed by signal id, consumed when
# the turn's bubbles are persisted.
_PENDING_ATTACH: dict[str, list[dict[str, Any]]] = {}


def stash_attach_items(signal_id: UUID | None, items: list[dict[str, Any]]) -> None:
    if not signal_id or not items:
        return
    key = str(signal_id)
    bucket = _PENDING_ATTACH.setdefault(key, [])
    seen = {(i.get("type"), i.get("id")) for i in bucket}
    for item in items:
        key2 = (item.get("type"), item.get("id"))
        if key2 in seen:
            continue
        seen.add(key2)
        bucket.append(item)
        if len(bucket) >= MAX_ITEMS:
            break


def take_attach_items(signal_id: UUID | None) -> list[dict[str, Any]]:
    if not signal_id:
        return []
    return _PENDING_ATTACH.pop(str(signal_id), [])


def snapshot_marketplace_slug(slug: str) -> dict[str, Any] | None:
    """Catalog card for a provider or host slug. No database."""
    from app.services.integrations_catalog import (
        HOST_BY_SLUG,
        PROVIDER_BY_SLUG,
        PROVIDERS,
        canonical_provider_slug,
    )

    key = canonical_provider_slug(slug)
    row = PROVIDER_BY_SLUG.get(key) if key else None
    if not isinstance(row, dict):
        host_key = (slug or "").strip().lower().replace("-", "_").replace(" ", "_")
        host = HOST_BY_SLUG.get(host_key)
        if host:
            for provider in PROVIDERS:
                if (provider.get("host") or {}).get("slug") == host["slug"]:
                    row = provider
                    key = str(provider.get("slug") or key)
                    break
    if not isinstance(row, dict) or not key:
        return None
    host = row.get("host") if isinstance(row.get("host"), dict) else {}
    host_slug = str(host.get("slug") or "").strip()
    use = host_slug or key
    return {
        "type": "marketplace",
        "id": use,
        "title": _clip(row.get("name") or row.get("title") or use),
        "subtitle": _clip(row.get("summary") or row.get("description") or "Not connected"),
        "kind": "marketplace",
        "provider": use,
    }


def infer_marketplace_items_from_text(text: str) -> list[dict[str, Any]]:
    """Marketplace cards are not inferred from prose.

    A word such as Outlook inside an email address used to become a connector
    card. Cards come from ``attach_items`` or a tool that showcases on purpose.
    """
    del text
    return []


_IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg")


def normalize_item_type(value: Any) -> str | None:
    key = str(value or "").strip().lower().replace("-", "_")
    key = _TYPE_ALIASES.get(key, key)
    return key if key in ITEM_TYPES else None


def _uuid(value: Any) -> UUID | None:
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        return None


def _clip(value: Any, limit: int = 140) -> str:
    text = " ".join(str(value or "").split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


_PREVIEW_KEEP = {
    "Stack",
    "Grid",
    "Row",
    "Card",
    "Heading",
    "Text",
    "Stat",
    "Badge",
    "Callout",
    "Divider",
    "List",
    "Table",
    "BarChart",
    "LineChart",
}
_PREVIEW_NODE_CAP = 16


def canvas_chat_preview(tree: Any) -> dict[str, Any] | None:
    """Small snapshot of a canvas document for the chat preview card."""
    if isinstance(tree, str):
        try:
            tree = json.loads(tree or "{}")
        except json.JSONDecodeError:
            return None
    if not isinstance(tree, dict):
        return None
    remaining = _PREVIEW_NODE_CAP

    def clip_text(value: Any, limit: int = 80) -> str:
        return _clip(value, limit)

    def walk(node: Any) -> dict[str, Any] | None:
        nonlocal remaining
        if remaining <= 0 or not isinstance(node, dict):
            return None
        kind = str(node.get("type") or "")
        if kind not in _PREVIEW_KEEP:
            return None
        remaining -= 1
        props_in = node.get("props") if isinstance(node.get("props"), dict) else {}
        props: dict[str, Any] = {}
        for key, value in props_in.items():
            if isinstance(value, str):
                props[key] = clip_text(value)
            elif isinstance(value, (int, float, bool)) or value is None:
                props[key] = value
            elif key == "series" and isinstance(value, list):
                series = []
                for item in value[:2]:
                    if not isinstance(item, dict):
                        continue
                    points = item.get("points") if isinstance(item.get("points"), list) else item.get("values")
                    series.append(
                        {
                            "name": clip_text(item.get("name") or item.get("label") or ""),
                            "points": list(points)[:4] if isinstance(points, list) else [],
                        }
                    )
                props[key] = series
            elif key == "rows" and isinstance(value, list):
                props[key] = value[:3]
            elif key == "columns" and isinstance(value, list):
                props[key] = [clip_text(cell, 40) for cell in value[:6]]
            elif key == "items" and isinstance(value, list):
                props[key] = [clip_text(cell, 60) for cell in value[:4]]
        children: list[Any] = []
        for child in node.get("children") or []:
            if isinstance(child, str) and child.strip():
                children.append(clip_text(child))
                continue
            walked = walk(child)
            if walked:
                children.append(walked)
        if kind == "Stack" and not children and not props:
            return None
        return {"type": kind, "props": props, "children": children}

    preview = walk(tree)
    if not preview or (preview.get("type") == "Stack" and not preview.get("children")):
        return None
    return preview


def _missing(item_type: str, ref: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": item_type,
        "id": str(ref.get("id") or ""),
        "title": _clip(ref.get("title") or ref.get("name") or ""),
        "subtitle": "",
        "missing": True,
    }


async def _knowledge_card(
    session: AsyncSession,
    tenant_id: UUID,
    ref: dict[str, Any],
    raw_id: Any,
) -> dict[str, Any] | None:
    """A workspace doc card. Product-help articles stay ``help_doc``."""
    from app.models.workspace import WorkspaceDoc

    row_id = _uuid(raw_id) or _uuid(ref.get("id"))
    row = None
    if row_id:
        row = (
            await session.execute(
                select(WorkspaceDoc).where(WorkspaceDoc.id == row_id, WorkspaceDoc.tenant_id == tenant_id)
            )
        ).scalar_one_or_none()
    if row is None:
        path = str(ref.get("path") or raw_id or "").strip().strip("/")
        if path:
            candidates = [path, path if path.endswith(".md") else f"{path}.md"]
            row = (
                await session.execute(
                    select(WorkspaceDoc).where(
                        WorkspaceDoc.tenant_id == tenant_id,
                        WorkspaceDoc.path.in_(candidates),
                    )
                )
            ).scalar_one_or_none()
    if row is None:
        title = str(ref.get("title") or ref.get("name") or raw_id or "").strip()
        if len(title) > 2:
            row = (
                await session.execute(
                    select(WorkspaceDoc).where(
                        WorkspaceDoc.tenant_id == tenant_id,
                        func.lower(WorkspaceDoc.title) == title.lower(),
                    )
                )
            ).scalar_one_or_none()
    if row is None:
        return None
    return {
        "type": "knowledge",
        "id": str(row.id),
        "title": _clip(row.title or row.path),
        "subtitle": _clip((row.kind or "doc").replace("_", " ")),
        "kind": row.kind,
        "path": f"/knowledge/{row.id}",
    }


def _is_image(name: str, content_type: str) -> bool:
    if content_type.lower().startswith("image/"):
        return True
    return name.lower().endswith(_IMAGE_EXTENSIONS)


async def _resolve_one(session: AsyncSession, tenant_id: UUID, ref: dict[str, Any]) -> dict[str, Any] | None:
    item_type = normalize_item_type(ref.get("type"))
    if not item_type:
        return None
    raw_id = ref.get("id")
    row_id = _uuid(raw_id)

    if item_type == "conversation":
        from app.models.signal import Signal

        row = (
            await session.execute(select(Signal).where(Signal.id == row_id, Signal.tenant_id == tenant_id))
        ).scalar_one_or_none() if row_id else None
        if not row:
            return _missing(item_type, ref)
        path = f"/communication/inbox/open/t/{row.id}"
        return {
            "type": item_type,
            "id": str(row.id),
            "title": _clip(row.subject or "(No subject)"),
            "subtitle": _clip(row.contact_name or ""),
            "kind": row.channel,
            "path": path,
            "url": path,
        }

    if item_type == "trash_entry":
        from app.models.trash import TrashEntry

        row = (
            await session.execute(
                select(TrashEntry).where(TrashEntry.id == row_id, TrashEntry.tenant_id == tenant_id)
            )
        ).scalar_one_or_none() if row_id else None
        if not row:
            return _missing(item_type, ref)
        return {
            "type": item_type,
            "id": str(row.id),
            "title": _clip(row.title or row.resource_type),
            "subtitle": _clip(row.preview),
            "kind": row.resource_type,
            "resource_id": str(row.resource_id),
            "deleted_at": row.deleted_at.isoformat() if row.deleted_at else None,
        }

    if item_type == "trigger":
        from app.models.trigger import Trigger

        row = (
            await session.execute(select(Trigger).where(Trigger.id == row_id, Trigger.tenant_id == tenant_id))
        ).scalar_one_or_none() if row_id else None
        if not row:
            return _missing(item_type, ref)
        return {
            "type": item_type,
            "id": str(row.id),
            "title": _clip(row.name),
            "subtitle": _clip(row.instructions, 100),
            "kind": row.kind,
            "at": row.next_run_at.isoformat() if row.next_run_at else None,
        }

    if item_type == "file":
        return await _resolve_file(session, tenant_id, ref)

    if item_type == "image":
        return _resolve_image(ref)

    if item_type == "user":
        from app.models.auth import Membership, User

        row = (
            await session.execute(
                select(User)
                .join(Membership, Membership.user_id == User.id)
                .where(User.id == row_id, Membership.tenant_id == tenant_id)
            )
        ).scalar_one_or_none() if row_id else None
        if not row:
            return _missing(item_type, ref)
        return {
            "type": item_type,
            "id": str(row.id),
            "title": _clip(row.display_name or row.email),
            "subtitle": _clip(row.email if row.display_name else ""),
            "image_url": row.avatar_url or None,
        }

    if item_type == "agent":
        from app.models.agent import Agent
        from app.services.agent_avatar import avatar_payload

        row = (
            await session.execute(select(Agent).where(Agent.id == row_id, Agent.tenant_id == tenant_id))
        ).scalar_one_or_none() if row_id else None
        if not row:
            return _missing(item_type, ref)
        mark = avatar_payload(row)
        return {
            "type": item_type,
            "id": str(row.id),
            "title": _clip(row.name),
            "subtitle": _clip(row.description, 100),
            "avatar_kind": mark.get("avatar_kind"),
            "avatar_icon": mark.get("avatar_icon"),
            "avatar_color": mark.get("avatar_color"),
            "avatar_shape": mark.get("avatar_shape"),
            "avatar_image_url": mark.get("avatar_image_url"),
            "image_url": mark.get("avatar_image_url"),
        }

    if item_type == "tag":
        from app.models.signal import SignalTag

        query = select(SignalTag).where(SignalTag.tenant_id == tenant_id)
        if row_id:
            query = query.where(SignalTag.id == row_id)
        else:
            name = str(ref.get("name") or raw_id or "").strip().lstrip("#").lower()
            if not name:
                return _missing(item_type, ref)
            query = query.where(func.lower(SignalTag.name) == name)
        row = (await session.execute(query.limit(1))).scalar_one_or_none()
        # A label plan row carries its own meta line; a new label has no row yet.
        meta = _clip(str(ref.get("subtitle") or ""), 140)
        if not row:
            if ref.get("planned") and not row_id:
                name = str(ref.get("name") or raw_id or "").strip().lstrip("#").lower()
                return {
                    "type": item_type,
                    "id": f"planned:{name}",
                    "title": name,
                    "subtitle": meta,
                    "kind": "tag",
                    "name": name,
                    "planned": True,
                }
            return _missing(item_type, ref)
        return {
            "type": item_type,
            "id": str(row.id),
            "title": row.name,
            "subtitle": meta or _clip(row.description, 100),
            "kind": "action_tag" if row.workstream_id else "tag",
            "name": row.name,
        }

    if item_type == "flow":
        from app.models.orchestra import Workstream

        row = (
            await session.execute(
                select(Workstream).where(Workstream.id == row_id, Workstream.tenant_id == tenant_id)
            )
        ).scalar_one_or_none() if row_id else None
        if not row:
            return _missing(item_type, ref)
        return {
            "type": item_type,
            "id": str(row.id),
            "title": row.name,
            "subtitle": _clip(row.description, 100),
        }

    if item_type in ("project", "folder"):
        from app.models.project import Project

        row = (
            await session.execute(select(Project).where(Project.id == row_id, Project.tenant_id == tenant_id))
        ).scalar_one_or_none() if row_id else None
        if not row:
            return _missing(item_type, ref)
        path = f"/folders/{row.id}"
        return {
            "type": "folder",
            "id": str(row.id),
            "title": _clip(row.name),
            "subtitle": _clip(row.description, 100),
            "path": path,
            "url": path,
        }

    if item_type == "canvas":
        from app.models.project import Project
        from app.models.project_canvas import ProjectCanvas
        from app.models.signal import Signal

        row = (
            await session.execute(
                select(ProjectCanvas).where(
                    ProjectCanvas.id == row_id,
                    ProjectCanvas.tenant_id == tenant_id,
                    ProjectCanvas.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none() if row_id else None
        if not row:
            return _missing(item_type, ref)
        from app.services.project_canvas import _thread_path, canvas_on_thread, serialize_canvas
        from app.services.works_in import GENERAL_FOLDER_NAMES, folder_href

        signal = await session.get(Signal, row.signal_id) if row.signal_id else None
        folder_id = None
        subtitle = ""
        if signal is not None and signal.project_id:
            project = (
                await session.execute(
                    select(Project).where(
                        Project.id == signal.project_id, Project.tenant_id == tenant_id
                    )
                )
            ).scalar_one_or_none()
            if project is not None and project.name not in set(GENERAL_FOLDER_NAMES.values()):
                subtitle = project.name
            if project is not None and project.deleted_at is None:
                folder_id = project.id
        serialized = serialize_canvas(row, folder_id=folder_id)
        empty = bool(serialized.get("empty"))
        content_kind = str(serialized.get("kind") or "dashboard")
        preview = None if empty or content_kind != "dashboard" else canvas_chat_preview(row.tree_json)
        if folder_id:
            path = folder_href(folder_id, "canvas", canvas=str(row.id))
        elif signal is not None:
            path = canvas_on_thread(
                _thread_path(row.managing_agent_id or signal.agent_id, signal.id),
                row.id,
            )
        else:
            path = None
        payload = {
            "type": item_type,
            "id": str(row.id),
            "title": _clip(row.title),
            "subtitle": _clip(subtitle),
            "canvas_kind": content_kind,
            "slug": row.slug,
            "path": None if empty else path,
            "folder_id": str(folder_id) if folder_id else None,
            "project_id": str(folder_id) if folder_id else None,
            "signal_id": str(row.signal_id) if row.signal_id else None,
            "empty": empty,
        }
        if preview:
            payload["preview"] = preview
        return payload

    if item_type == "contact":
        from app.models.channel import Contact

        row = (
            await session.execute(select(Contact).where(Contact.id == row_id, Contact.tenant_id == tenant_id))
        ).scalar_one_or_none() if row_id else None
        if not row:
            return _missing(item_type, ref)
        subtitle = " · ".join(part for part in (row.company, row.address) if part)
        return {
            "type": item_type,
            "id": str(row.id),
            "title": _clip(row.display_name or row.address),
            "subtitle": _clip(subtitle),
            "kind": row.channel,
        }

    if item_type == "integration":
        from app.models.integration import IntegrationConnection
        from app.services.integrations_catalog import PROVIDER_BY_SLUG, canonical_provider_slug

        query = select(IntegrationConnection).where(IntegrationConnection.tenant_id == tenant_id)
        provider = ""
        if row_id:
            query = query.where(IntegrationConnection.id == row_id)
        else:
            raw_provider = (
                str(ref.get("provider") or raw_id or "").strip().lower().replace("-", "_").replace(" ", "_")
            )
            provider = canonical_provider_slug(raw_provider)
            if not provider and not raw_provider:
                return _missing(item_type, ref)
            # Match either the short name or the catalog slug (e.g. slack / slack_mcp).
            candidates = {p for p in (raw_provider, provider) if p}
            query = query.where(
                func.lower(IntegrationConnection.provider).in_(candidates),
                IntegrationConnection.status == "active",
            )
        row = (await session.execute(query.limit(1))).scalar_one_or_none()
        if row:
            slug = canonical_provider_slug(row.provider) or row.provider
            return {
                "type": item_type,
                "id": str(row.id),
                "title": _clip(row.display_name or row.provider),
                "subtitle": _clip(f"{slug} · {row.status}"),
                "kind": row.kind,
                "provider": slug,
            }
        # Not connected yet — fall back to a catalog showcase card with logo.
        slug = provider or canonical_provider_slug(str(ref.get("provider") or raw_id or ""))
        catalog = PROVIDER_BY_SLUG.get(slug) if slug else None
        if isinstance(catalog, dict):
            return {
                "type": "marketplace",
                "id": slug,
                "title": _clip(catalog.get("name") or catalog.get("title") or slug),
                "subtitle": _clip(
                    catalog.get("summary") or catalog.get("description") or "Not connected"
                ),
                "kind": "marketplace",
                "provider": slug,
            }
        missing = _missing(item_type, {**ref, "id": slug or str(raw_id or "")})
        if slug:
            missing["provider"] = slug
            missing["title"] = missing["title"] or _clip(slug.replace("_", " ").title())
        return missing

    if item_type == "marketplace":
        from app.services.integrations_catalog import PROVIDER_BY_SLUG, canonical_provider_slug

        slug = canonical_provider_slug(str(ref.get("slug") or ref.get("provider") or raw_id or ""))
        row = PROVIDER_BY_SLUG.get(slug) if slug else None
        if not isinstance(row, dict):
            missing = _missing(item_type, {**ref, "id": slug or str(raw_id or "")})
            if slug:
                missing["provider"] = slug
                missing["title"] = missing["title"] or _clip(slug.replace("_", " ").title())
            return missing
        return {
            "type": item_type,
            "id": slug,
            "title": _clip(row.get("name") or row.get("title") or slug),
            "subtitle": _clip(row.get("summary") or row.get("description") or "Not connected"),
            "kind": "marketplace",
            "provider": slug,
        }

    if item_type == "module":
        from app.modules.catalog import get_module, serialize_modules_for_tenant

        slug = str(ref.get("slug") or raw_id or "").strip().lower()
        spec = get_module(slug) if slug else None
        if not spec:
            return _missing(item_type, {**ref, "id": slug or str(raw_id or "")})
        rows = await serialize_modules_for_tenant(session, tenant_id)
        row = next((item for item in rows if item.get("slug") == slug), None)
        if not isinstance(row, dict):
            return _missing(item_type, {**ref, "id": slug})
        package = row.get("package") if isinstance(row.get("package"), dict) else {}
        persona = package.get("agent_template") if isinstance(package.get("agent_template"), dict) else {}
        hired = str(row.get("specialist_agent_name") or "").strip()
        providers = [
            str(name)
            for name in list(row.get("provider_slugs") or []) + list(row.get("planned_provider_slugs") or [])
            if str(name).strip()
        ]
        return {
            "type": item_type,
            "id": slug,
            "title": _clip(row.get("name") or spec.name),
            "subtitle": _clip(row.get("description") or spec.description, 280),
            "kind": str(row.get("tenant_status") or "not_installed"),
            "slug": slug,
            "path": str(row.get("setup_path") or spec.setup_path),
            "module_status": str(row.get("status") or spec.status),
            "install_state": str(row.get("install_state") or "not_installed"),
            "tool_count": len(row.get("tool_cards") or []),
            "provider_slugs": providers,
            "name": _clip(hired or persona.get("name") or ""),
            "job_title": _clip(persona.get("job_title") or ""),
            "role_blurb": _clip(persona.get("role_blurb") or "", 280),
            "avatar_kind": str(row.get("specialist_avatar_kind") or "orb"),
            "avatar_icon": row.get("specialist_avatar_icon"),
            "avatar_color": row.get("specialist_avatar_color") or persona.get("avatar_color"),
            "avatar_shape": row.get("specialist_avatar_shape") or persona.get("avatar_shape") or "bokito",
            "avatar_image_url": row.get("specialist_avatar_image_url"),
        }

    if item_type == "help_doc":
        from app.services.product_help import get_article

        path = str(ref.get("path") or ref.get("slug") or raw_id or "").strip().strip("/")
        # Accept "section/slug" or bare slug.
        parts = [p for p in path.split("/") if p]
        slug = parts[-1] if parts else ""
        article = get_article(slug) if slug else None
        if article:
            return {
                "type": item_type,
                "id": f"{article.section}/{article.slug}",
                "title": _clip(article.title),
                "subtitle": _clip(article.intro or article.section),
                "kind": "help_doc",
                "section": article.section,
                "slug": article.slug,
                "path": f"/docs/{article.section}/{article.slug}",
            }
        knowledge = await _knowledge_card(session, tenant_id, ref, raw_id)
        if knowledge:
            return knowledge
        return _missing(item_type, {**ref, "id": path or slug})

    if item_type == "knowledge":
        card = await _knowledge_card(session, tenant_id, ref, raw_id)
        if card:
            return card
        return _missing(item_type, ref)

    if item_type == "message":
        from app.models.signal import SignalMessage

        row = (
            await session.execute(
                select(SignalMessage).where(SignalMessage.id == row_id, SignalMessage.tenant_id == tenant_id)
            )
        ).scalar_one_or_none() if row_id else None
        if not row:
            return _missing(item_type, ref)
        preview = _clip(row.body_preview or row.body_text or row.subject or "", 120)
        return {
            "type": item_type,
            "id": str(row.id),
            "title": _clip(row.subject or preview or "Message"),
            "subtitle": preview if row.subject else "",
            "kind": row.kind or row.role,
            "signal_id": str(row.signal_id),
            "message_id": str(row.id),
        }

    return None


def _resolve_image(ref: dict[str, Any]) -> dict[str, Any]:
    """Remote image URL for showcase (e.g. from ``web_search`` kind=images)."""
    from urllib.parse import urlparse

    url = str(ref.get("url") or ref.get("image_url") or ref.get("id") or "").strip()
    if not url.startswith(("http://", "https://")):
        return _missing("image", ref)
    host = ""
    try:
        host = (urlparse(url).hostname or "").removeprefix("www.")
    except Exception:
        logger.debug('proposal image host parse failed', exc_info=True)
        host = ""
    title = _clip(ref.get("title") or ref.get("name") or host or "Image", 120)
    return {
        "type": "image",
        "id": url,
        "title": title,
        "subtitle": _clip(ref.get("subtitle") or host, 100),
        "url": url,
        "image_url": str(ref.get("image_url") or url),
        "kind": "image",
    }


async def _resolve_file(session: AsyncSession, tenant_id: UUID, ref: dict[str, Any]) -> dict[str, Any]:
    """A file is an attachment on a message (``message_id`` + ``name``/``index``)."""
    import json

    from app.models.signal import SignalMessage

    message_id = _uuid(ref.get("message_id"))
    attachment: dict[str, Any] | None = None
    if message_id:
        row = (
            await session.execute(
                select(SignalMessage).where(
                    SignalMessage.id == message_id, SignalMessage.tenant_id == tenant_id
                )
            )
        ).scalar_one_or_none()
        if row:
            try:
                attachments = json.loads(row.attachments_json or "[]")
            except json.JSONDecodeError:
                attachments = []
            attachments = [a for a in attachments if isinstance(a, dict)]
            wanted = str(ref.get("name") or "").strip().lower()
            if wanted:
                attachment = next(
                    (a for a in attachments if str(a.get("name") or a.get("filename") or "").lower() == wanted),
                    None,
                )
            elif attachments:
                index = ref.get("index")
                position = index if isinstance(index, int) and 0 <= index < len(attachments) else 0
                attachment = attachments[position]
    if not attachment:
        return _missing("file", ref)
    name = str(attachment.get("name") or attachment.get("filename") or "file")
    content_type = str(attachment.get("content_type") or attachment.get("contentType") or "")
    url = str(attachment.get("url") or "")
    size = attachment.get("size")
    return {
        "type": "file",
        "id": str(attachment.get("id") or name),
        "title": _clip(name),
        "subtitle": content_type,
        "message_id": str(message_id),
        "url": url or None,
        "image_url": url if url and _is_image(name, content_type) else None,
        "size": size if isinstance(size, int) else None,
    }


_ID_KEYS = {
    "agent_id": "agent",
    "project_id": "project",
    "canvas_id": "canvas",
    "contact_id": "contact",
    "workstream_id": "flow",
    "trigger_id": "trigger",
    "user_id": "user",
}


def policy_item_refs(
    tool_name: str,
    tool_input: dict[str, Any],
    *,
    current_signal_id: UUID | None = None,
) -> list[dict[str, Any]]:
    """Refs a gated tool call is about, so its approval card can show them."""
    refs: list[dict[str, Any]] = []
    if tool_name == "restore_trash_item" and tool_input.get("id"):
        refs.append({"type": "trash_entry", "id": tool_input["id"]})
    elif tool_name == "delete_tag":
        if tool_input.get("id"):
            refs.append({"type": "tag", "id": tool_input["id"]})
        elif tool_input.get("name"):
            refs.append({"type": "tag", "name": str(tool_input["name"])})
    elif tool_name == "assign_conversation" and tool_input.get("kind") == "agent" and tool_input.get("id"):
        refs.append({"type": "agent", "id": tool_input["id"]})
    elif tool_name == "set_thread_tags":
        refs.extend({"type": "tag", "name": str(tag)} for tag in tool_input.get("tags") or [] if str(tag).strip())
    elif tool_name == "close_threads":
        refs.extend({"type": "conversation", "id": sid} for sid in (tool_input.get("signal_ids") or [])[:MAX_ITEMS])
    elif tool_name in ("connect_integration", "suggest_integration", "propose_integration"):
        provider = str(tool_input.get("provider") or tool_input.get("display_name") or "").strip()
        if provider:
            refs.append({"type": "marketplace", "id": provider})
    elif tool_name in ("recommend_module", "enable_module"):
        slug = str(tool_input.get("slug") or tool_input.get("module") or "").strip()
        if slug:
            refs.append({"type": "module", "id": slug})
    elif tool_name == "setup_integration":
        slug = str(tool_input.get("slug") or tool_input.get("module") or "").strip()
        provider = str(tool_input.get("provider") or "").strip()
        if slug:
            refs.append({"type": "module", "id": slug})
        if provider:
            refs.append({"type": "marketplace", "id": provider})
    for key, item_type in _ID_KEYS.items():
        if tool_input.get(key):
            refs.append({"type": item_type, "id": tool_input[key]})
    signal_id = tool_input.get("signal_id")
    if signal_id and str(signal_id) != str(current_signal_id or ""):
        refs.append({"type": "conversation", "id": signal_id})
    return refs


async def resolve_items(
    session: AsyncSession,
    tenant_id: UUID,
    refs: list[Any] | None,
) -> list[dict[str, Any]]:
    """Resolve item refs into display snapshots (unknown types are skipped)."""
    items: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for ref in refs or []:
        if not isinstance(ref, dict):
            continue
        item = await _resolve_one(session, tenant_id, ref)
        if not item:
            continue
        key = (item["type"], item["id"])
        if item["id"] and key in seen:
            continue
        seen.add(key)
        items.append(item)
        if len(items) >= MAX_ITEMS:
            break
    return items
