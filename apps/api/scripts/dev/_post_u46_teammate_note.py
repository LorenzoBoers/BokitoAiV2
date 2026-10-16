"""Post an internal note as QA Teammate on Ask thread (U46 dual-user authors)."""
import asyncio
from datetime import datetime
from uuid import UUID

from sqlalchemy import select

from app.db.session import async_session_factory
from app.models.auth import User
from app.models.signal import Signal, SignalMessage
from app.gateway.publish import publish_thread_update

ASK = UUID("000fefc7-bd1b-40f9-9f44-f6b24f9cb925")
EMAIL = "qa.teammate@bokito.ai"
BODY = "QA U46: notitie van QA Teammate — dual-user author check."


async def main() -> None:
    async with async_session_factory() as s:
        user = (await s.execute(select(User).where(User.email == EMAIL))).scalar_one()
        sig = (await s.execute(select(Signal).where(Signal.id == ASK))).scalar_one()
        now = datetime.utcnow()
        msg = SignalMessage(
            signal_id=ASK,
            tenant_id=sig.tenant_id,
            kind="internal_note",
            direction="internal",
            role="user",
            body_text=BODY,
            body_html="",
            body_preview=BODY[:200],
            author_user_id=user.id,
            created_at=now,
        )
        s.add(msg)
        sig.last_message_at = now
        sig.updated_at = now
        await s.commit()
        await publish_thread_update(sig)
        print({"ok": True, "message_id": str(msg.id), "author": user.display_name or EMAIL})


if __name__ == "__main__":
    asyncio.run(main())
