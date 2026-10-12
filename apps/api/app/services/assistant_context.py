"""Shared prompt context for in-app assistant turns.

Both assistant transports send the screen the operator is looking at with
every turn — the widget on the in-app surface and the Messages chat API —
so they format it the same way.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

MAX_PAGE_CONTEXT_CHARS = 500
MAX_CATEGORY_MAP_LINES = 24


def page_context_block(page_context: str) -> str:
    """System block describing what the operator currently has open."""
    text = " ".join((page_context or "").split())
    if not text:
        return ""
    return (
        "## Operator page context\n"
        f"The operator is currently viewing: {text[:MAX_PAGE_CONTEXT_CHARS]}\n"
        "Use this to ground your help in what they see on screen."
    )


async def category_map_block(session: AsyncSession, tenant_id: UUID) -> str:
    """Compact map so agents know each category's playbook and the folders that carry it."""
    from sqlalchemy import select

    from app.models.orchestra import Workstream
    from app.services.folders import load_tree
    from app.services.tickets import list_categories

    categories = await list_categories(session, tenant_id)
    if not categories:
        return ""
    shown = categories[:MAX_CATEGORY_MAP_LINES]
    ws_names = dict(
        (
            await session.execute(
                select(Workstream.id, Workstream.name).where(Workstream.tenant_id == tenant_id)
            )
        ).all()
    )
    tree = await load_tree(session, tenant_id)
    lines: list[str] = []
    for tag in shown:
        folders = [
            tree.static_path(node.id).label for node in tree.nodes.values() if node.tag_id == tag.id
        ]
        where = f"; folders: {', '.join(folders)}" if folders else ""
        lines.append(f"#{tag.name} -> playbook {ws_names.get(tag.workstream_id, '?')}{where}")
    return (
        "## Categories\n"
        "A category is a hashtag with a playbook. Filing one makes this conversation "
        "a ticket in that playbook's stages. A conversation has at most one category; "
        "a second request is a split. Use list_categories then file_ticket. The folder "
        "follows from the conversation's tags (own, action tag, contact); add a tag with "
        "set_thread_tags instead of guessing a folder.\n"
        + "\n".join(lines)
    )
