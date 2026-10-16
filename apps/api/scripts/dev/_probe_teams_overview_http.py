"""Call team_overview handler against live DB (no HTTP auth)."""
from __future__ import annotations

import asyncio
import traceback
from types import SimpleNamespace

from sqlalchemy import text

from app.db.session import async_session_factory
from app.models.auth import Membership, User
from app.routers.teams import OverviewOut, team_overview
from sqlalchemy import select


async def main() -> None:
    async with async_session_factory() as session:
        tid = (await session.execute(text("SELECT id FROM tenants LIMIT 1"))).scalar()
        row = (
            await session.execute(
                select(User, Membership)
                .join(Membership, Membership.user_id == User.id)
                .where(Membership.tenant_id == tid)
                .limit(1)
            )
        ).one()
        user, membership = row
        tenant = SimpleNamespace(id=tid)
        auth = SimpleNamespace(
            tenant=tenant,
            user=user,
            membership=membership,
            require_role=lambda *a, **k: None,
        )
        try:
            result = await team_overview(auth=auth, session=session)
            validated = OverviewOut.model_validate(result)
            print(
                "OK",
                "people",
                len(validated.people),
                "agents",
                len(validated.agents),
                "teams",
                len(validated.teams),
            )
        except Exception:
            print("FAIL")
            traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())
