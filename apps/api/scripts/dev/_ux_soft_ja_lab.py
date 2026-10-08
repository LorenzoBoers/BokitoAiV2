"""One soft Ja/Nee card for composer soft-match UI test."""

from __future__ import annotations

import asyncio
import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.config import get_settings
from app.models.agent import Agent
from app.models.auth import Tenant, User
from app.models.signal import Signal
from app.services.assistant_threads import append_signal_chat_message
from app.tools.builtin import _propose_action
from app.tools.registry import ToolContext


async def main() -> None:
    settings = get_settings()
    engine = create_async_engine(settings.database_url)
    factory = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        tenant = None
        for slug in ("bokito-ai", "bokito", "test"):
            tenant = (await session.execute(select(Tenant).where(Tenant.slug == slug))).scalar_one_or_none()
            if tenant:
                break
        assert tenant
        agent = (
            await session.execute(
                select(Agent).where(Agent.tenant_id == tenant.id, Agent.slug == "assistant")
            )
        ).scalar_one_or_none() or (
            await session.execute(select(Agent).where(Agent.tenant_id == tenant.id))
        ).scalars().first()
        assert agent
        user = (await session.execute(select(User).limit(1))).scalar_one()
        signal = Signal(
            tenant_id=tenant.id,
            channel="assistant",
            source="chat",
            subject="UX soft Ja composer",
            status="open",
            agent_id=agent.id,
            contact_name=agent.name,
        )
        session.add(signal)
        await session.flush()
        await append_signal_chat_message(
            session, signal, role="user", content="Klaar voor soft Ja.", author_user_id=user.id
        )
        await session.commit()
        ctx = ToolContext(
            session=session,
            tenant_id=tenant.id,
            user_id=user.id,
            agent=agent,
            signal_id=signal.id,
        )
        result = await _propose_action(
            ctx,
            {
                "question": "Zal ik doorgaan?",
                "options": [
                    {"id": "yes", "label": "Ja"},
                    {"id": "reject", "label": "Nee", "action_type": "reject"},
                ],
            },
        )
        await session.commit()
        print(json.dumps({"signal_id": str(signal.id), "decision": result.get("decision_request_id")}))
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
