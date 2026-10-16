"""Verify same-bundle Ja/Nee flood is blocked (U75)."""
import asyncio
from uuid import uuid4

from sqlalchemy import select

from app.db.session import async_session_factory
from app.models.agent import Agent
from app.models.auth import Tenant
from app.models.signal import Signal
from app.tools.builtin import _create_decision_request
from app.tools.registry import ToolContext


async def main() -> None:
    async with async_session_factory() as s:
        tenant = (await s.execute(select(Tenant).limit(1))).scalar_one()
        agent = (
            await s.execute(select(Agent).where(Agent.tenant_id == tenant.id).limit(1))
        ).scalar_one()
        sig = Signal(
            tenant_id=tenant.id,
            channel="assistant",
            subject="U75 probe",
            status="open",
            agent_id=agent.id,
        )
        s.add(sig)
        await s.flush()
        ctx = ToolContext(
            session=s,
            tenant_id=tenant.id,
            user_id=None,
            agent=agent,
            signal_id=sig.id,
            trust="operator",
            turn_id="u75-" + str(uuid4())[:8],
        )
        first = await _create_decision_request(
            ctx,
            {
                "title": "Mag ik A?",
                "options": [{"id": "ja", "label": "Ja"}, {"id": "nee", "label": "Nee"}],
            },
        )
        second = await _create_decision_request(
            ctx,
            {
                "title": "Mag ik B?",
                "options": [{"id": "ja", "label": "Ja"}, {"id": "nee", "label": "Nee"}],
            },
        )
        print("first", first.get("status"), str(first.get("decision_request_id", ""))[:8])
        print("second", second.get("status"), str(second.get("decision_request_id", ""))[:8])
        assert second.get("status") == "already_open"
        assert second.get("decision_request_id") == first.get("decision_request_id")
        print("U75_OK")


if __name__ == "__main__":
    asyncio.run(main())
