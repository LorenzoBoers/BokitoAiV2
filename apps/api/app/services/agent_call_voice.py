"""Realtime voice session for an agent call.

The session carries two tools only: consult the running agent, or confirm
the open decision. Audio stays between the browser and the voice provider.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx
from fastapi import HTTPException

from app.config import get_settings

logger = logging.getLogger(__name__)

_TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "name": "consult_run",
        "description": (
            "Ask the agent run that is doing the work. Use this when you are "
            "not sure, need a fact from the workspace, or need an action. "
            "Tell the person you are checking, then wait for a run update."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "question": {
                    "type": "string",
                    "description": "What the run should look up or do, in one sentence.",
                }
            },
            "required": ["question"],
        },
    },
    {
        "type": "function",
        "name": "confirm_choice",
        "description": (
            "Record the person's choice on the open decision. Call this only "
            "after they clearly pick one of the options."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "option_id": {"type": "string"},
                "label": {"type": "string"},
            },
        },
    },
]


def voice_instructions(
    *,
    agent_name: str,
    title: str,
    summary: str,
    options: list[dict[str, Any]],
) -> str:
    lines = [
        f"You are {agent_name}, on a live call with the person you work with.",
        "Speak as that agent. Short spoken sentences. No lists, no markdown.",
        f"The open decision is: {title}.",
    ]
    if summary.strip():
        lines.append(f"Context: {summary.strip()}")
    if options:
        lines.append("Options:")
        for option in options:
            label = str(option.get("label") or option.get("title") or option.get("id") or "")
            option_id = str(option.get("id") or "")
            if label:
                lines.append(f"- {label} (id: {option_id})")
    lines.extend(
        [
            "Open by stating the decision and the options.",
            "If you do not know something, call consult_run and say you are checking.",
            "A message that starts with [Run update] is the agent run reporting back. "
            "Say that result in your own voice. Do not read the bracket label.",
            "When the person picks an option, call confirm_choice with its id, then confirm aloud.",
            "You cannot change the workspace yourself. Only the run can.",
        ]
    )
    return "\n".join(lines)


async def create_realtime_secret(instructions: str) -> dict[str, Any]:
    settings = get_settings()
    key = (settings.openai_api_key or "").strip()
    if not key:
        raise HTTPException(status_code=503, detail="Voice is not configured")
    payload = {
        "expires_after": {"anchor": "created_at", "seconds": 600},
        "session": {
            "type": "realtime",
            "model": settings.openai_realtime_model,
            "instructions": instructions,
            "tools": _TOOLS,
            "tool_choice": "auto",
            "audio": {
                "input": {"transcription": {"model": "whisper-1"}},
                "output": {"voice": settings.openai_realtime_voice},
            },
        },
    }
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(
                "https://api.openai.com/v1/realtime/client_secrets",
                headers={
                    "Authorization": f"Bearer {key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
    except httpx.HTTPError as exc:
        logger.warning("realtime client secret failed: %s", exc)
        raise HTTPException(status_code=503, detail="Voice is unavailable") from exc
    if response.status_code >= 400:
        logger.warning("realtime client secret %s", response.status_code)
        raise HTTPException(status_code=503, detail="Voice is unavailable")
    body = response.json()
    value = str(body.get("value") or "")
    if not value:
        raise HTTPException(status_code=503, detail="Voice is unavailable")
    return {"value": value, "expires_at": body.get("expires_at")}
