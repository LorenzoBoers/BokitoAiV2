"""Probe: list the scheduled view per tenant and run one wake tick (dev only)."""

import asyncio

from sqlalchemy import select

from app.db.session import async_session_factory
from app.models.auth import Membership, Tenant, User, user_numeric_id
from app.models.trigger import Trigger
from app.services.signal_threads import list_threads
from app.services.thread_schedule import wake_due_threads


async def main() -> None:
    async with async_session_factory() as session:
        tenants = (await session.execute(select(Tenant).limit(5))).scalars().all()
        for tenant in tenants:
            row = (
                await session.execute(
                    select(User)
                    .join(Membership, Membership.user_id == User.id)
                    .where(Membership.tenant_id == tenant.id)
                    .limit(1)
                )
            ).scalar_one_or_none()
            if row is None:
                continue
            result = await list_threads(
                session, tenant.id, row.id, user_numeric_id(row.id), view="scheduled", per_page=5
            )
            items = result.get("items", []) if isinstance(result, dict) else result
            rules = (
                await session.execute(
                    select(Trigger).where(
                        Trigger.tenant_id == tenant.id,
                        Trigger.deleted_at.is_(None),
                        Trigger.purpose == "",
                    )
                )
            ).scalars().all()
            orphan = [t.name for t in rules if t.signal_id is None and t.kind != "webhook"]
            print(tenant.slug, "scheduled:", len(items), "rules:", len(rules), "rules without thread:", orphan)
            for item in items[:3]:
                print("   ", item.get("subject"), item.get("next_at"), bool(item.get("schedule")))
        print("woken:", await wake_due_threads(session))


asyncio.run(main())
