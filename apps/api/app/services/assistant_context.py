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


def settings_guide_block() -> str:
    """Where operators change account vs workspace settings (deep links).

    Injected for the personal Bokito helper so it never invents that the
    dashboard UI is English-only, and can send people to the right page.
    """
    return (
        "## Settings map\n"
        "Two different language settings exist — never confuse them:\n"
        "- **Dashboard UI language** (menus, labels, Settings pages): per "
        "person, Dutch or English. Path: [/settings/profile](/settings/profile) "
        "(Profile & security → Language). Call get_operator_settings to read "
        "the current value. Never say the UI cannot be Dutch or English.\n"
        "- **Organization working language** (how agents write for the team): "
        "per workspace. Path: [/settings/communication](/settings/communication).\n"
        "Other common destinations:\n"
        "- Workspace name / platform support → [/settings/general](/settings/general)\n"
        "- Branding → [/settings/branding](/settings/branding)\n"
        "- Channels & mailboxes → [/settings/channels](/settings/channels)\n"
        "- AI handling (autonomy dial) → [/settings/ai-handling](/settings/ai-handling)\n"
        "- Notifications → [/settings/notifications](/settings/notifications)\n"
        "- Members & teams → [/team](/team)\n"
        "When someone wants a setting changed, link the path with real UI "
        "labels and walk them there. Prefer get_operator_settings before "
        "guessing their UI language."
    )


async def category_map_block(session: AsyncSession, tenant_id: UUID) -> str:
    """Compact map so agents know each category's playbook and the folders that carry it."""
    from sqlalchemy import select

    from app.models.orchestra import Workstream
    from app.services.folders import folder_path_label, load_catalog, matching_folders
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
    catalog = await load_catalog(session, tenant_id)
    lines: list[str] = []
    for tag in shown:
        folders = [
            folder_path_label(f)
            for f in matching_folders(catalog, [tag.id])
            if tag.id in f.tag_set
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
