"""Side-task tools that run another agent and report back."""

from __future__ import annotations

from typing import Any


from app.tools.registry import ToolContext, ToolSpec, register_tool


async def _spawn_subagent(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services import subagents

    return await subagents.spawn(ctx, tool_input)


async def _get_subagent_output(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services import subagents

    return await subagents.output(ctx, tool_input)


async def _kill_subagent(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services import subagents

    return await subagents.kill(ctx, tool_input)


async def _send_subagent_message(ctx: ToolContext, tool_input: dict[str, Any]) -> dict[str, Any]:
    from app.services import subagents

    return await subagents.send_message(ctx, tool_input)


register_tool(
    ToolSpec(
        name="spawn_subagent",
        description=(
            "Hand one piece of work to a subagent with its own context. It sees only "
            "your prompt, not this conversation, so write a complete brief. Its final "
            "message comes back to you as the result. Background (default): you get the "
            "result in this conversation when it ends. run_in_background=false waits up "
            "to 120 seconds. Leave agent_id empty to start a copy of yourself."
        ),
        category="delegation",
        input_schema={
            "type": "object",
            "properties": {
                "prompt": {"type": "string", "description": "Complete brief for the subagent"},
                "description": {"type": "string", "description": "3-8 word label shown in the thread"},
                "run_in_background": {"type": "boolean", "default": True},
                "resume_from": {"type": "string", "description": "run_id of a completed subagent of the same agent"},
                "model": {"type": "string", "description": "Model slug override"},
                "agent_id": {"type": "string", "description": "Agent to run; default is you"},
                "persona": {"type": "string", "description": "Workspace persona name"},
                "role": {"type": "string", "description": "Workspace role name"},
            },
            "required": ["prompt", "description"],
        },
        handler=_spawn_subagent,
        display_name="Started subagent",
    )
)

register_tool(
    ToolSpec(
        name="get_subagent_output",
        description="Status and result of a subagent you started.",
        category="delegation",
        input_schema={
            "type": "object",
            "properties": {"run_id": {"type": "string"}},
            "required": ["run_id"],
        },
        handler=_get_subagent_output,
        mutating=False,
        gated=False,
        display_name="Read subagent result",
    )
)

register_tool(
    ToolSpec(
        name="kill_subagent",
        description="Stop a subagent you started.",
        category="delegation",
        input_schema={
            "type": "object",
            "properties": {"run_id": {"type": "string"}},
            "required": ["run_id"],
        },
        handler=_kill_subagent,
        gated=False,
        display_name="Stopped subagent",
    )
)

register_tool(
    ToolSpec(
        name="send_subagent_message",
        description=(
            "Send a running subagent a follow-up. steer (default) and interject land "
            "before its next step (interject first); queue waits until it would stop."
        ),
        category="delegation",
        input_schema={
            "type": "object",
            "properties": {
                "run_id": {"type": "string"},
                "message": {"type": "string"},
                "delivery": {"type": "string", "enum": ["steer", "queue", "interject"]},
            },
            "required": ["run_id", "message"],
        },
        handler=_send_subagent_message,
        gated=False,
        display_name="Messaged subagent",
    )
)
