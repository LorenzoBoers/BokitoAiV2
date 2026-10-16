"""Ensure a second Platform-support member for Suite D UI tests."""
from __future__ import annotations

import asyncio
from uuid import UUID

from sqlalchemy import select

from app.db.session import async_session_factory
from app.models.auth import Membership, User
from app.services.auth import hash_password

TENANT = UUID("231e4ade-6b58-494b-9042-ec860d845a0e")
EMAIL = "qa.teammate@bokito.ai"
PASSWORD = "bokito-test-password"
DISPLAY = "QA Teammate"


async def main() -> None:
    async with async_session_factory() as s:
        user = (
            await s.execute(select(User).where(User.email == EMAIL))
        ).scalar_one_or_none()
        if user is None:
            user = User(
                email=EMAIL,
                password_hash=hash_password(PASSWORD),
                first_name="QA",
                last_name="Teammate",
                display_name=DISPLAY,
                email_verified=True,
                is_active=True,
            )
            s.add(user)
            await s.flush()
            print(f"created_user={user.id}")
        else:
            user.password_hash = hash_password(PASSWORD)
            user.display_name = DISPLAY
            user.is_active = True
            user.email_verified = True
            print(f"updated_user={user.id}")
        user.last_tenant_id = TENANT

        mem = (
            await s.execute(
                select(Membership).where(
                    Membership.tenant_id == TENANT,
                    Membership.user_id == user.id,
                )
            )
        ).scalar_one_or_none()
        if mem is None:
            s.add(Membership(tenant_id=TENANT, user_id=user.id, role="member", is_active=True))
            print("created_membership")
        else:
            mem.is_active = True
            mem.role = mem.role or "member"
            print(f"updated_membership role={mem.role}")

        await s.commit()
        print(f"ok email={EMAIL} password={PASSWORD}")


if __name__ == "__main__":
    asyncio.run(main())
