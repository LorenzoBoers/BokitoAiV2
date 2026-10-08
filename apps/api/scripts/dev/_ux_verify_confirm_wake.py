"""Seed one delete proposal, approve it, wait for wake, assert no re-propose storm."""

from __future__ import annotations

import asyncio
import json
from uuid import uuid4

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.config import get_settings
from app.models.agent import Agent
from app.models.auth import Tenant, User
from app.models.notification import DecisionRequest
from app.models.signal import Signal, SignalMessage, SignalTag
from app.services.assistant_threads import append_signal_chat_message
from app.tools.builtin import _propose_action
from app.tools.registry import ToolContext
from scripts.seed import TEST_EMAIL, TEST_PASSWORD


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
        tag = f"ux-confirm-{uuid4().hex[:5]}"
        session.add(SignalTag(tenant_id=tenant.id, name=tag))
        signal = Signal(
            tenant_id=tenant.id,
            channel="assistant",
            source="chat",
            subject="UX confirm-only wake",
            status="open",
            agent_id=agent.id,
            contact_name=agent.name,
        )
        session.add(signal)
        await session.flush()
        await append_signal_chat_message(
            session, signal, role="user", content="Verwijder die testtag.", author_user_id=user.id
        )
        await session.commit()
        ctx = ToolContext(
            session=session,
            tenant_id=tenant.id,
            user_id=user.id,
            agent=agent,
            signal_id=signal.id,
        )
        proposed = await _propose_action(
            ctx,
            {
                "question": f"Verwijder #{tag}?",
                "action": "delete_tag",
                "payload": {"name": tag},
                "approve_label": f"Ja, verwijder #{tag}",
                "reject_label": "Nee",
            },
        )
        did = proposed["decision_request_id"]
        msg = (
            await session.execute(
                select(SignalMessage).where(SignalMessage.decision_id == __import__("uuid").UUID(did))
            )
        ).scalar_one()
        await session.commit()
        signal_id = str(signal.id)
        message_id = str(msg.id)

    async with httpx.AsyncClient(base_url="http://127.0.0.1:8000", timeout=60.0) as client:
        login = await client.post("/api/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
        headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
        res = await client.post(
            f"/api/signals/{signal_id}/messages/{message_id}/resolve",
            headers=headers,
            json={"action": "approve", "option_id": "approve"},
        )
        assert res.status_code == 200, res.text
        # Wait for coalesce + agent turn
        await asyncio.sleep(8.0)
        detail = await client.get(f"/api/signals/{signal_id}", headers=headers)
        data = detail.json()
        msgs = data.get("messages") or []
        open_decisions = 0
        assistant_after = []
        for m in msgs:
            if m.get("kind") == "decision_request":
                dec = (m.get("payload") or {}).get("decision") or {}
                if dec.get("status") == "awaiting_human":
                    open_decisions += 1
            if m.get("role") == "assistant" and m.get("kind") != "decision_request":
                assistant_after.append((m.get("body_text") or "")[:120])
        # Fresh propose after approve would leave >0 awaiting cards besides none.
        print(
            json.dumps(
                {
                    "signal_id": signal_id,
                    "tag": tag,
                    "open_awaiting": open_decisions,
                    "assistant_tails": assistant_after[-3:],
                    "ok": open_decisions == 0,
                },
                indent=2,
            )
        )
        if open_decisions != 0:
            raise SystemExit(1)
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
