"""Seed the staging stack: autotrading tenant + dedicated trader user."""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select

from app.db.session import async_session_factory, init_db
from app.models.auth import Membership, Tenant, User
from app.services.auth import hash_password
from app.services.tenant_bootstrap import bootstrap_tenant, default_tenant_settings, serialize_settings

TRADER_EMAIL = "trader@staging.bokito.ai"
TRADER_PASSWORD = "staging-trader-password"
TENANT_SLUG = "autotrading"
TENANT_NAME = "Autotrading Staging"


async def seed_staging() -> None:
    await init_db()
    async with async_session_factory() as session:
        tenant_result = await session.execute(select(Tenant).where(Tenant.slug == TENANT_SLUG))
        tenant = tenant_result.scalar_one_or_none()
        if not tenant:
            tenant = Tenant(
                slug=TENANT_SLUG,
                name=TENANT_NAME,
                settings_json=serialize_settings(default_tenant_settings()),
            )
            session.add(tenant)
            await session.flush()
            await bootstrap_tenant(session, tenant.id)

        user_result = await session.execute(select(User).where(User.email == TRADER_EMAIL))
        user = user_result.scalar_one_or_none()
        if not user:
            user = User(
                email=TRADER_EMAIL,
                password_hash=hash_password(TRADER_PASSWORD),
                display_name="Staging Trader",
            )
            session.add(user)
            await session.flush()

        membership_result = await session.execute(
            select(Membership).where(Membership.user_id == user.id, Membership.tenant_id == tenant.id)
        )
        if not membership_result.scalar_one_or_none():
            session.add(Membership(tenant_id=tenant.id, user_id=user.id, role="owner"))

        await session.commit()
        print(f"staging_seed_ok tenant={TENANT_SLUG} user={TRADER_EMAIL}")

        if os.environ.get("SEED_TRADING_TENANT", "").strip() in ("1", "true", "yes"):
            from scripts.tenants.autotrading.bootstrap import seed_trading_stack

            trading = await seed_trading_stack(session, tenant.id)
            print(f"trading_stack_ok {trading}")


if __name__ == "__main__":
    asyncio.run(seed_staging())
