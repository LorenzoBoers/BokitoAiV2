"""Seed: one binary Ja/Nee + one multi card — soft composer Ja should hit the binary."""

from __future__ import annotations

import asyncio
import json
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.config import get_settings
from app.models.agent import Agent
from app.models.auth import Tenant, User
from app.models.signal import Signal, SignalTag
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
        tag = f"ux-soft-{uuid4().hex[:5]}"
        session.add(SignalTag(tenant_id=tenant.id, name=tag))
        signal = Signal(
            tenant_id=tenant.id,
            channel="assistant",
            source="chat",
            subject="UX soft binary + multi",
            status="open",
            agent_id=agent.id,
            contact_name=agent.name,
        )
        session.add(signal)
        await session.flush()
        await append_signal_chat_message(
            session, signal, role="assistant", content="Multi open + een Ja/Nee.", author_agent_id=agent.id
        )
        await session.commit()
        ctx = ToolContext(
            session=session,
            tenant_id=tenant.id,
            user_id=user.id,
            agent=agent,
            signal_id=signal.id,
        )
        multi = await _propose_action(
            ctx,
            {
                "question": "Welke tags houden we?",
                "selection": "multiple",
                "options": [
                    {"id": "a", "label": "#alpha"},
                    {"id": "b", "label": "#beta"},
                    {"id": "reject", "label": "Geen", "action_type": "reject"},
                ],
            },
        )
        binary = await _propose_action(
            ctx,
            {
                "question": f"Verwijder #{tag}?",
                "action": "delete_tag",
                "payload": {"name": tag},
                "approve_label": f"Ja, verwijder #{tag}",
                "reject_label": "Nee",
            },
        )
        await session.commit()
        print(
            json.dumps(
                {
                    "signal_id": str(signal.id),
                    "tag": tag,
                    "multi": multi.get("decision_request_id"),
                    "binary": binary.get("decision_request_id"),
                    "url": f"/communication/agent/{agent.id}/t/{signal.id}",
                }
            )
        )
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
