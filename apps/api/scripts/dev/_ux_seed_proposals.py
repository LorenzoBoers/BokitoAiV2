"""Seed controlled proposal cards on a live assistant thread for UI UX testing."""

from __future__ import annotations

import asyncio
import json
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.config import get_settings
from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.signal import Signal, SignalTag
from app.tools.builtin import _propose_action
from app.tools.registry import ToolContext


SIGNAL_ID = UUID("28c5745e-ba3f-4227-afd6-2acd9213cf1e")


async def main() -> None:
    settings = get_settings()
    engine = create_async_engine(settings.database_url)
    factory = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        signal = await session.get(Signal, SIGNAL_ID)
        if signal is None:
            print("signal missing")
            return
        tenant = await session.get(Tenant, signal.tenant_id)
        agent = None
        if signal.agent_id:
            agent = await session.get(Agent, signal.agent_id)
        if agent is None:
            agent = (
                await session.execute(select(Agent).where(Agent.tenant_id == signal.tenant_id))
            ).scalars().first()
        assert tenant and agent
        tag_name = f"uxdel-{uuid4().hex[:5]}"
        session.add(SignalTag(tenant_id=tenant.id, name=tag_name))
        await session.commit()

        ctx = ToolContext(
            session=session,
            tenant_id=tenant.id,
            user_id=None,
            agent=agent,
            signal_id=signal.id,
        )

        cases = [
            {
                "name": "executable_delete",
                "input": {
                    "question": f"UX-test: verwijder #{tag_name} definitief?",
                    "action": "delete_tag",
                    "payload": {"name": tag_name},
                    "approve_label": f"Ja, verwijder #{tag_name}",
                    "reject_label": "Nee, hou aan",
                    "items": [{"type": "tag", "id": tag_name}],
                },
            },
            {
                "name": "soft_yes_no",
                "input": {
                    "question": "UX-test soft: wil je koffie?",
                    "options": [
                        {"id": "yes", "label": "Ja graag"},
                        {"id": "reject", "label": "Nee dank"},
                    ],
                },
            },
            {
                "name": "text_input",
                "input": {
                    "question": "UX-test: welke naam voor de nieuwe tag?",
                    "options": [
                        {
                            "id": "name",
                            "label": "Naam typen",
                            "input_type": "text",
                            "input_placeholder": "bijv. onboarding",
                        },
                        {"id": "reject", "label": "Annuleren"},
                    ],
                },
            },
            {
                "name": "multi_select",
                "input": {
                    "question": "UX-test: welke tags houden we?",
                    "selection": "multiple",
                    "options": [
                        {"id": "klacht", "label": "#klacht"},
                        {"id": "storing", "label": "#storing"},
                        {"id": "spam", "label": "#spam"},
                        {"id": "reject", "label": "Geen"},
                    ],
                },
            },
        ]

        results = []
        for case in cases:
            out = await _propose_action(ctx, case["input"])
            results.append({"name": case["name"], "out": out})
            print(case["name"], json.dumps(out, default=str)[:240])

        print("TAG", tag_name)
        print("DONE", len(results))
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
