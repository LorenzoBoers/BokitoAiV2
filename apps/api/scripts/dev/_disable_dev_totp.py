"""Dev-only: clear TOTP so UI login works without authenticator (bokito-dev)."""
from __future__ import annotations

import asyncio

from sqlalchemy import select

from app.db.session import async_session_factory
from app.models.auth import User

EMAILS = ("admin@bokito.ai", "lorenzo@bokito.ai")


async def main() -> None:
    async with async_session_factory() as session:
        rows = (
            await session.execute(select(User).where(User.email.in_(EMAILS)))
        ).scalars().all()
        if not rows:
            print("no users matched", EMAILS)
            return
        for user in rows:
            print("before", user.email, "totp_enabled=", user.totp_enabled)
            user.totp_enabled = False
            user.totp_secret = ""
            user.totp_pending_secret = ""
            session.add(user)
        await session.commit()
        rows = (
            await session.execute(select(User).where(User.email.in_(EMAILS)))
        ).scalars().all()
        for user in rows:
            print("after", user.email, "totp_enabled=", user.totp_enabled)


if __name__ == "__main__":
    asyncio.run(main())
