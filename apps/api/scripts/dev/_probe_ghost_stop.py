"""Inspect ghost Stop sources: active_turn, agent live, chat runs."""
import asyncio
from uuid import UUID

from sqlalchemy import select, text

from app.db.session import async_session_factory
from app.models.agent import Agent
from app.models.signal import Signal

SID = UUID("14cb3ae9-c892-458b-9e71-05f093d5aa47")


async def main() -> None:
    async with async_session_factory() as s:
        sig = (await s.execute(select(Signal).where(Signal.id == SID))).scalar_one()
        print("active_turn=", sig.active_turn_json)
        agents = (await s.execute(select(Agent).limit(20))).scalars().all()
        for a in agents:
            live = getattr(a, "live_status", None) or getattr(a, "status", None)
            activity = getattr(a, "live_activity_id", None) or getattr(a, "activity_id", None)
            name = a.name
            # print interesting fields
            fields = {
                k: getattr(a, k, None)
                for k in (
                    "live_status",
                    "status",
                    "live_activity",
                    "live_activity_id",
                    "activity",
                    "presence",
                )
                if hasattr(a, k)
            }
            if any(fields.values()) or "Extra" in name or "Orch" in name or "Bokito" in name:
                print(name, fields)
        # recent chat_run / agent_run if tables exist
        try:
            rows = (
                await s.execute(
                    text(
                        """
                        SELECT id, status, agent_id, created_at, finished_at
                        FROM agent_runs
                        WHERE signal_id = :sid
                        ORDER BY created_at DESC
                        LIMIT 5
                        """
                    ),
                    {"sid": str(SID)},
                )
            ).mappings().all()
            print("agent_runs", [dict(r) for r in rows])
        except Exception as e:
            print("agent_runs err", type(e).__name__, e)


if __name__ == "__main__":
    asyncio.run(main())
