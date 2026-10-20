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
    Every path is a real page; tests fail on a path the dashboard does not route.
    """
    return (
        "## Settings map\n"
        "Two different language settings exist; never confuse them:\n"
        "- **Dashboard UI language** (menus, labels, Settings pages): per "
        "person, Dutch or English. Path: [/settings/profile](/settings/profile) "
        "(Profile & security, Language). Call get_operator_settings to read "
        "the current value. Never say the UI cannot be Dutch or English.\n"
        "- **Organization working language** (how agents write for the team): "
        "per workspace. Path: [/settings/govern?tab=policy](/settings/govern?tab=policy) "
        "(Govern, Policy, Organization working language).\n"
        "Other common destinations:\n"
        "- Autonomy (one dial: Manual, Assisted, Autonomous), channel defaults, "
        "safeguards and handover: [/settings/govern?tab=policy](/settings/govern?tab=policy)\n"
        "- Workspace name and platform support: [/settings/general](/settings/general)\n"
        "- Branding: [/settings/branding](/settings/branding)\n"
        "- Channels and mailboxes: [/settings/channels](/settings/channels)\n"
        "- Labels: [/settings/labels](/settings/labels)\n"
        "- Connections: [/settings/connections](/settings/connections)\n"
        "- Usage: [/settings/usage](/settings/usage)\n"
        "- Notifications: [/settings/notifications](/settings/notifications)\n"
        "- People, agents and departments (Workforce): [/workforce](/workforce)\n"
        "When someone wants a setting changed, link the path with real UI "
        "labels and walk them there. Prefer get_operator_settings before "
        "guessing their UI language."
    )


PLATFORM_SHAPE = (
    "## How Bokito is shaped\n"
    "Five concepts. A **conversation** is everything that comes in or is started; a "
    "status makes it a ticket, a date puts it on the agenda. A **folder** (Werkmap) is "
    "where work on one subject is filed: a client, a job, a case. Folders nest. A folder "
    "is not a department. Which folders exist, or storing work in a werkmap, is "
    "list_folders — never list_departments. A **department** (Afdeling) is a group of "
    "people and agents. list_departments returns only those groups, including All people "
    "and All agents. Never call a department a folder or a werkmap. "
    "A folder's **Works in** lists where that work is done: board, files "
    "and canvases in Bokito, and connections such as a repository, a Drive folder or an "
    "accounting package. What a conversation produced shows as **Delivered** in the "
    "thread. A **flow** is how one kind of work runs: stages, an owner per stage and an "
    "optional destination (Delivers to: one folder, optionally one Works in item). An "
    "**agent** is an AI teammate with a ceiling. **Autonomy** is what an agent may do "
    "alone: one dial in Govern ([/settings/govern?tab=policy](/settings/govern?tab=policy)). "
    "**Today** is the first item in Communication ([/communication/today](/communication/today)). "
    "Labels, channels and contacts are properties and filters, not destinations.\n"
    "A label files a conversation. A label with a flow makes the conversation a ticket "
    "in that flow; a conversation has at most one such label. Color and icon exist only "
    "while that flow is attached. The folder follows from the labels; the folder name "
    "is not proof of what the message is. Closing is close_thread. \"No reply needed\" "
    "is one card for the operator, not a second copy of the same judgement.\n"
    "list_tags is the catalog. The filing brief is what is on this conversation. "
    "file_ticket is the only way to file a label with a flow. set_thread_tags adds or "
    "removes labels without a flow on this conversation, and never deletes a label from "
    "the workspace. Remove a label that does not fit before any other filing action."
)


async def category_map_block(session: AsyncSession, tenant_id: UUID) -> str:
    """Platform shape and vocabulary, plus each flow label's flow and its folders.

    Every agent's system prompt carries this block.
    """
    from sqlalchemy import select

    from app.models.orchestra import Workstream
    from app.services.folders import folder_path_label, load_catalog, matching_folders
    from app.services.tickets import list_categories

    from app.services.vocabulary import vocabulary_block

    shape = "\n\n".join(part for part in (PLATFORM_SHAPE, vocabulary_block()) if part)
    categories = await list_categories(session, tenant_id)
    if not categories:
        return shape
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
        lines.append(f"#{tag.name} -> flow {ws_names.get(tag.workstream_id, '?')}{where}")
    return (
        f"{shape}\n\n"
        "## Categories\n"
        "A label with a flow is a hashtag that starts a ticket. Filing one makes this "
        "conversation a ticket in that flow's stages. A conversation has at most one; "
        "a second request is a split. Use list_categories then file_ticket. The folder "
        "follows from the conversation's labels (own, the label with a flow, contact). "
        "Add or remove a label that has no flow with set_thread_tags instead of guessing "
        "a folder.\n"
        + "\n".join(lines)
    )


def _hash_list(names: list[str]) -> str:
    cleaned = [n for n in names if n]
    return ", ".join(f"#{n}" for n in cleaned) if cleaned else "none"


async def conversation_filing_brief(session: AsyncSession, signal) -> str:
    """Labels, the flow label and the folder currently on one conversation."""
    from app.services.folders import (
        effective_tag_ids,
        inherited_tag_names,
        load_catalog,
        serialize_folder_paths,
    )
    from app.services.signal_tags import signal_tag_names
    from app.services.tickets import ticket_payload

    own = await signal_tag_names(session, signal.id)
    inherited = await inherited_tag_names(session, signal)
    ticket = await ticket_payload(session, signal)
    catalog = await load_catalog(session, signal.tenant_id)
    paths = serialize_folder_paths(catalog, await effective_tag_ids(session, signal))
    folder = ", ".join(p.get("label") or p.get("name") or "" for p in paths if p.get("label") or p.get("name"))
    if ticket:
        stage = (ticket.get("stage") or {}).get("name") or ticket.get("stage_key") or "unset"
        flow = ticket.get("workstream_name") or "unset"
        action = f"#{ticket.get('name')} in flow {flow}, stage {stage}"
    else:
        action = "none"
    return (
        "## Filing on this conversation\n"
        f"Free labels on this conversation: {_hash_list(own)}\n"
        f"Inherited from the contact or company (not removable here): {_hash_list(inherited)}\n"
        f"Label with a flow: {action}\n"
        f"Folder: {folder or 'none'}\n"
        "If a label or folder does not fit the message, say so and correct this "
        "conversation's own free labels with set_thread_tags before any other filing "
        "action. If the folder is wrong, take that free label off before "
        "note_no_reply, so the card does not offer that folder's queue. Do not "
        "treat the folder name as proof that the mail is that kind of work."
    )
