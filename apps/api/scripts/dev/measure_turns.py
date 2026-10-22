"""Time three agent turns (greeting, question, action) for a before/after comparison.

Usage: python scripts/dev/measure_turns.py <agent_id> [label]
Prints one JSON line per turn: seconds, first-text seconds, rounds, tokens, stop reason.
"""

from __future__ import annotations

import asyncio
import json
import sys
import time
from uuid import UUID

TURNS = (
    ("greeting", "hoi"),
    ("question", "Wat is het verschil tussen een label en een werkmap?"),
    ("action", "Kun je kijken welke flows er zijn en welke daarvan op altijd beoordelen staan?"),
)


async def _one(agent_id: UUID, name: str, text: str) -> dict:
    from app.db.session import async_session_factory
    from app.models.agent import Agent
    from app.services.agent.loop import AgentLoop

    async with async_session_factory() as session:
        agent = await session.get(Agent, agent_id)
        loop = AgentLoop(session, agent.tenant_id, None, agent=agent, trust="operator", surface="operator_chat")
        rounds: list[float] = []
        first_text: list[float] = []
        started = time.monotonic()
        inner = loop._llm_chat

        async def counted(messages, max_tokens):
            response = await inner(messages, max_tokens)
            rounds.append(time.monotonic() - started)
            if not first_text and any(
                b.get("type") == "text" and (b.get("text") or "").strip() for b in response.get("content") or []
            ):
                first_text.append(time.monotonic() - started)
            return response

        loop._llm_chat = counted
        reply, tokens = await loop.run_chat([{"role": "user", "content": text}])
        await session.rollback()
        return {
            "turn": name,
            "seconds": round(time.monotonic() - started, 1),
            "first_text_s": round(first_text[0], 1) if first_text else None,
            "rounds": len(rounds),
            "input_tokens": tokens.get("input_tokens"),
            "output_tokens": tokens.get("output_tokens"),
            "stop": loop.stop_reason,
            "effort": getattr(loop, "effort", None),
            "budget": getattr(loop, "thinking_budget", None),
            "reply": (reply or "")[:160],
        }


async def main() -> None:
    agent_id = UUID(sys.argv[1])
    label = sys.argv[2] if len(sys.argv) > 2 else ""
    for name, text in TURNS:
        row = await _one(agent_id, name, text)
        row["label"] = label
        print(json.dumps(row, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    asyncio.run(main())
