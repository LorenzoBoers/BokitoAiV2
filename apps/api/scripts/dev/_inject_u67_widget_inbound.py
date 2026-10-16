"""Inject inbound on widget so U67 stale draft can compare basedOn."""
import asyncio
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import select

from app.db.session import async_session_factory
from app.gateway.publish import publish_thread_update
from app.models.signal import Signal, SignalMessage

SID = UUID("6466f9a1-1eef-4f8e-a03d-f1fa7ce563af")
BODY = "QA U67 widget inbound u67win"


async def main() -> None:
    async with async_session_factory() as s:
        sig = (await s.execute(select(Signal).where(Signal.id == SID))).scalar_one()
        now = datetime.utcnow()
        old = SignalMessage(
            signal_id=SID,
            tenant_id=sig.tenant_id,
            kind="user_message",
            direction="inbound",
            role="user",
            body_text="older widget inbound",
            body_html="",
            body_preview="older",
            external_id=f"qa-u67-old-{uuid4().hex[:8]}",
            created_at=now,
            received_at=now,
        )
        s.add(old)
        await s.flush()
        newer = SignalMessage(
            signal_id=SID,
            tenant_id=sig.tenant_id,
            kind="user_message",
            direction="inbound",
            role="user",
            body_text=BODY,
            body_html="",
            body_preview=BODY[:200],
            external_id=f"qa-u67-new-{uuid4().hex[:8]}",
            created_at=now,
            received_at=now,
        )
        s.add(newer)
        sig.last_message_at = now
        await s.commit()
        await publish_thread_update(sig)
        print({"old": str(old.id), "new": str(newer.id)})


if __name__ == "__main__":
    asyncio.run(main())
