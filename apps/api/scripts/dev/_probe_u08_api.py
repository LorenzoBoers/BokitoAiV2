"""Call get_thread serialization path for U08 visibility."""
from __future__ import annotations

import asyncio
from uuid import UUID

from sqlalchemy import select

from app.db.session import async_session_factory
from app.models.auth import Membership, Tenant, User
from app.services import signal_threads as svc

SID = UUID("84c74f47-51bd-476c-ac12-4fcf1ac6f912")


async def main() -> None:
    async with async_session_factory() as s:
        tenant = (
            await s.execute(select(Tenant).where(Tenant.slug == "platform-support"))
        ).scalar_one_or_none()
        if tenant is None:
            tenant = (await s.execute(select(Tenant).limit(1))).scalar_one()
        mem = (
            await s.execute(
                select(Membership).where(Membership.tenant_id == tenant.id).limit(1)
            )
        ).scalar_one()
        user = await s.get(User, mem.user_id)
        detail = await svc.get_thread(s, tenant.id, user.id, SID)
        msgs = detail.get("messages") if isinstance(detail, dict) else None
        if msgs is None and hasattr(detail, "get"):
            msgs = detail.get("messages")
        # get_thread may return a dict already
        if not isinstance(detail, dict):
            print("detail type", type(detail))
            print(detail)
            return
        print("message_count", len(detail.get("messages") or []))
        for m in (detail.get("messages") or [])[-12:]:
            body = (m.get("body_text") or m.get("body") or "")[:100]
            print(m.get("created_at"), m.get("kind"), m.get("role"), repr(body))


if __name__ == "__main__":
    asyncio.run(main())
