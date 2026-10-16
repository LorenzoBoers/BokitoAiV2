"""List all memberships (incl inactive) for Suite D."""
from __future__ import annotations

import asyncio

from sqlalchemy import text

from app.db.session import async_session_factory

TENANT = "231e4ade-6b58-494b-9042-ec860d845a0e"


async def main() -> None:
    async with async_session_factory() as s:
        rows = (
            await s.execute(
                text(
                    """
                    SELECT u.id, u.email, u.display_name, m.role, m.is_active,
                           COALESCE(u.password_hash, '') <> '' AS has_password
                    FROM users u
                    JOIN memberships m ON m.user_id = u.id
                    WHERE m.tenant_id = :tid
                    ORDER BY u.email
                    """
                ),
                {"tid": TENANT},
            )
        ).all()
        print(f"tenant={TENANT}")
        for r in rows:
            print(r)


if __name__ == "__main__":
    asyncio.run(main())
