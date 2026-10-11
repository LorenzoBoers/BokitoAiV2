import asyncio

from sqlmodel import select

from app.db.session import async_session_factory
from app.models.signal import Signal, SignalMessage
from app.services.agent.mention_repair import repair_mentions


async def main() -> None:
    async with async_session_factory() as session:
        rows = (
            await session.execute(
                select(SignalMessage, Signal.tenant_id)
                .join(Signal, Signal.id == SignalMessage.signal_id)
                .where(SignalMessage.author_agent_id.is_not(None), SignalMessage.body_text.contains("@["))
            )
        ).all()
        fixed = 0
        for msg, tenant_id in rows:
            new = await repair_mentions(session, tenant_id, msg.body_text or "")
            if new != msg.body_text:
                msg.body_text = new
                fixed += 1
                print(msg.id, new[:200])
        await session.commit()
        print("fixed", fixed, "of", len(rows))


asyncio.run(main())
