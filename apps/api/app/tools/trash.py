"""Trash list and restore tools."""

from __future__ import annotations

from typing import Any


from app.tools.registry import ToolContext, ToolSpec, register_tool


async def _list_trash(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services.trash import list_entries

    return await list_entries(
        ctx.session,
        ctx.tenant_id,
        resource_type=tool_input.get("type"),
        q=tool_input.get("q"),
        limit=int(tool_input.get("limit") or 30),
    )


async def _restore_trash_item(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from uuid import UUID as _UUID

    from app.services.trash import get_entry, load_tenant, restore_entry

    entry_id = _UUID(str(tool_input.get("id") or ""))
    tenant = await load_tenant(ctx.session, ctx.tenant_id)
    entry = await get_entry(ctx.session, ctx.tenant_id, entry_id)
    return await restore_entry(ctx.session, tenant, entry, user_id=ctx.user_id)


register_tool(
    ToolSpec(
        name="list_trash",
        description=(
            "List items currently in the workspace Bin (soft-deleted, recoverable). "
            "Omit type to see every kind. Conversations are type 'conversation' "
            "(also accept signal/thread). Other types: folder, canvas, knowledge, "
            "contact, company, flow, trigger, team, inbox_rule."
        ),
        category="workspace",
        input_schema={
            "type": "object",
            "properties": {
                "type": {
                    "type": "string",
                    "description": (
                        "Optional Bin type. Use conversation for deleted chats "
                        "(aliases: signal, thread). Leave empty to list all."
                    ),
                },
                "q": {"type": "string"},
                "limit": {"type": "integer"},
            },
        },
        handler=_list_trash,
        mutating=False,
        gated=False,
    )
)

register_tool(
    ToolSpec(
        name="restore_trash_item",
        description=(
            "Restore an item from the workspace Bin. This is consequential: "
            "calling it raises an Approve/Reject card for the operator — do not "
            "only ask in chat whether to restore; call this tool with the item "
            "id so they can approve. Restoring a child while the parent is "
            "still in the Bin fails until the parent is restored."
        ),
        category="workspace",
        input_schema={
            "type": "object",
            "properties": {"id": {"type": "string"}},
            "required": ["id"],
        },
        handler=_restore_trash_item,
        mutating=True,
        gated=True,
        consequential=True,
    )
)
