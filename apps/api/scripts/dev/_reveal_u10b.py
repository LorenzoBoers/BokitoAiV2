"""Reveal latest U10b deferred decision onto the ask thread; supersede siblings."""
from __future__ import annotations

import asyncio
from datetime import datetime
from uuid import UUID

from sqlalchemy import select

from app.db.session import async_session_factory
from app.models.notification import DecisionRequest
from app.services.signal_decisions import reveal_decision

ASK = UUID("84c74f47-51bd-476c-ac12-4fcf1ac6f912")
KEEP = UUID("f4a4e5a0-3f94-4849-b99c-d51e1b31f515")


async def main() -> None:
    async with async_session_factory() as s:
        rows = (
            await s.execute(
                select(DecisionRequest).where(
                    DecisionRequest.signal_id == ASK,
                    DecisionRequest.status == "awaiting_human",
                    DecisionRequest.message_id.is_(None),
                    DecisionRequest.title == "U10 afronden",
                )
            )
        ).scalars().all()
        for d in rows:
            if d.id == KEEP:
                continue
            d.status = "deferred"
            d.chosen_option_id = "superseded"
            d.resolved_at = datetime.utcnow()
            s.add(d)
        keep = await s.get(DecisionRequest, KEEP)
        if keep is None:
            print("missing keep")
            return
        keep.signal_id = ASK
        s.add(keep)
        msg = await reveal_decision(s, keep.tenant_id, keep)
        await s.commit()
        print("revealed", keep.id, "msg", msg.id if msg else None, "kind", msg.kind if msg else None)


if __name__ == "__main__":
    asyncio.run(main())
