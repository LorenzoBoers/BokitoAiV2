"""Seed a clean assistant thread with proposal variants for UI UX scenarios."""

from __future__ import annotations

import asyncio
import json
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.config import get_settings
from app.models.agent import Agent
from app.models.auth import Tenant, User
from app.models.signal import Signal, SignalMessage, SignalTag
from app.services.assistant_threads import append_signal_chat_message
from app.tools.builtin import _propose_action
from app.tools.registry import ToolContext


async def main() -> None:
    settings = get_settings()
    engine = create_async_engine(settings.database_url)
    factory = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        tenant = (await session.execute(select(Tenant).where(Tenant.slug != "platform").limit(1))).scalar_one()
        # Prefer Bokito AI tenant if present
        for slug in ("bokito-ai", "bokito", "test"):
            row = (await session.execute(select(Tenant).where(Tenant.slug == slug))).scalar_one_or_none()
            if row:
                tenant = row
                break
        agent = (
            await session.execute(
                select(Agent).where(Agent.tenant_id == tenant.id, Agent.slug == "assistant")
            )
        ).scalar_one_or_none()
        if agent is None:
            agent = (
                await session.execute(select(Agent).where(Agent.tenant_id == tenant.id))
            ).scalars().first()
        assert agent is not None
        user = (await session.execute(select(User).limit(1))).scalar_one()

        tag_a = f"ux-a-{uuid4().hex[:5]}"
        tag_b = f"ux-b-{uuid4().hex[:5]}"
        session.add(SignalTag(tenant_id=tenant.id, name=tag_a))
        session.add(SignalTag(tenant_id=tenant.id, name=tag_b))
        signal = Signal(
            tenant_id=tenant.id,
            channel="assistant",
            source="chat",
            subject="UX scenario lab",
            status="open",
            agent_id=agent.id,
            contact_name=agent.name,
        )
        session.add(signal)
        await session.flush()

        await append_signal_chat_message(
            session,
            signal,
            role="user",
            content="Start UX scenario lab.",
            author_user_id=user.id,
        )
        await append_signal_chat_message(
            session,
            signal,
            role="assistant",
            content="Klaar voor voorstellen. Gebruik de knoppen hieronder.",
            author_agent_id=agent.id,
        )
        await session.commit()

        ctx = ToolContext(
            session=session,
            tenant_id=tenant.id,
            user_id=user.id,
            agent=agent,
            signal_id=signal.id,
        )
        cases = [
            ("S1_delete", {
                "question": f"Verwijder #{tag_a}?",
                "action": "delete_tag",
                "payload": {"name": tag_a},
                "approve_label": f"Ja, verwijder #{tag_a}",
                "reject_label": "Nee, hou aan",
                "items": [{"type": "tag", "name": tag_a}],
            }),
            ("S2_soft", {
                "question": "Wil je koffie?",
                "options": [
                    {"id": "yes", "label": "Ja graag"},
                    {"id": "reject", "label": "Nee dank"},
                ],
            }),
            ("S3_text", {
                "question": "Welke naam voor de tag?",
                "options": [
                    {"id": "name", "label": "Naam typen", "input_type": "text", "input_placeholder": "bijv. onboarding"},
                    {"id": "reject", "label": "Annuleren"},
                ],
            }),
            ("S4_multi", {
                "question": "Welke tags houden we?",
                "selection": "multiple",
                "options": [
                    {"id": "klacht", "label": "#klacht"},
                    {"id": "storing", "label": "#storing"},
                    {"id": "spam", "label": "#spam"},
                    {"id": "reject", "label": "Geen"},
                ],
            }),
            ("S5_delete_b", {
                "question": f"Verwijder ook #{tag_b}?",
                "action": "delete_tag",
                "payload": {"name": tag_b},
                "approve_label": f"Ja, verwijder #{tag_b}",
                "reject_label": "Nee",
            }),
        ]
        out = {"signal_id": str(signal.id), "tag_a": tag_a, "tag_b": tag_b, "agent": agent.name, "cases": {}}
        for name, payload in cases:
            result = await _propose_action(ctx, payload)
            out["cases"][name] = result.get("decision_request_id")
            print(name, result.get("decision_request_id"))
        print(json.dumps(out))
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
