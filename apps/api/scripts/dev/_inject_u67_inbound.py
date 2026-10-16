"""Inject newer inbound on mail host so an open proposal/draft can go stale (U67)."""
import asyncio
from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import select

from app.db.session import async_session_factory
from app.models.signal import Signal, SignalMessage
from app.gateway.publish import publish_thread_update

SIGNAL_ID = UUID("14cb3ae9-c892-458b-9e71-05f093d5aa47")
BODY = "QA U67 inbound: klant stuurt nóg een bericht na concept. u67in"


async def main() -> None:
    async with async_session_factory() as s:
        sig = (await s.execute(select(Signal).where(Signal.id == SIGNAL_ID))).scalar_one()
        now = datetime.utcnow()
        msg = SignalMessage(
            signal_id=SIGNAL_ID,
            tenant_id=sig.tenant_id,
            kind="user_message",
            direction="inbound",
            role="user",
            from_address="customer@example.com",
            subject="Re: Invoice",
            body_text=BODY,
            body_html="",
            body_preview=BODY[:200],
            external_id=f"qa-u67-{uuid4().hex[:10]}",
            auto_sent=False,
            created_at=now,
            received_at=now,
        )
        s.add(msg)
        sig.last_message_at = now
        sig.updated_at = now
        await s.commit()
        await publish_thread_update(sig)
        print({"ok": True, "message_id": str(msg.id), "body": BODY})


if __name__ == "__main__":
    asyncio.run(main())
