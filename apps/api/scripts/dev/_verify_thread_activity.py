"""Verify decision card activity is readable for the inbox thread."""
from __future__ import annotations

import asyncio
import json
from uuid import UUID

from sqlalchemy import select

from app.db.session import async_session_factory
from app.models.signal import SignalMessage
from app.services.agent.turn_persist import message_activity

SIGNAL = UUID("088d8126-4509-4c90-b8cf-394b5992db6b")
CARD = UUID("73b75c22-202e-46be-9c47-70856d04f252")


async def main() -> None:
    async with async_session_factory() as session:
        card = await session.get(SignalMessage, CARD)
        assert card is not None
        meta = json.loads(card.metadata_json or "{}")
        shaped = message_activity(meta, detail=False)
        print("tools", [a.get("tool") or a.get("kind") for a in shaped["activity"]])
        print("statuses", [a.get("status") for a in shaped["activity"]])
        # Confirm newest open decision still has based_on + activity.
        latest = (
            await session.execute(
                select(SignalMessage)
                .where(
                    SignalMessage.signal_id == SIGNAL,
                    SignalMessage.kind == "decision_request",
                )
                .order_by(SignalMessage.created_at.desc())
                .limit(1)
            )
        ).scalar_one()
        latest_meta = json.loads(latest.metadata_json or "{}")
        print(
            "latest",
            latest.id,
            "based_on",
            latest_meta.get("based_on_message_id"),
            "n_activity",
            len(latest_meta.get("activity") or []),
        )


if __name__ == "__main__":
    asyncio.run(main())
