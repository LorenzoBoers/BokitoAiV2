"""Ensure Support agent is a participant on the internal S31 host."""
from __future__ import annotations

import asyncio
import uuid

from sqlalchemy import text

from app.db.session import async_session_factory

HOST = "72fbd32a-fb2c-4f12-8d7c-eb13ed87de58"
SUPPORT = "5a232347-decf-48f8-b5a6-2d7b7edc596e"


async def main() -> None:
    async with async_session_factory() as s:
        tenant = (
            await s.execute(
                text("SELECT tenant_id::text FROM signals WHERE id = :id"),
                {"id": HOST},
            )
        ).scalar_one()
        existing = (
            await s.execute(
                text(
                    """
                    SELECT id::text, kind, ref_id::text, role, left_at
                    FROM signal_participants
                    WHERE signal_id = :sig
                    ORDER BY joined_at
                    """
                ),
                {"sig": HOST},
            )
        ).fetchall()
        print("before:", existing)
        has = any(str(r[2]) == SUPPORT and r[1] == "agent" and r[4] is None for r in existing)
        if not has:
            await s.execute(
                text(
                    """
                    INSERT INTO signal_participants
                      (id, tenant_id, signal_id, kind, ref_id, role, joined_via, invited_by_kind)
                    VALUES
                      (:id, :tenant, :sig, 'agent', :ref, 'member', 'invite', 'user')
                    ON CONFLICT DO NOTHING
                    """
                ),
                {
                    "id": str(uuid.uuid4()),
                    "tenant": tenant,
                    "sig": HOST,
                    "ref": SUPPORT,
                },
            )
            await s.commit()
            print("inserted Support participant")
        else:
            print("Support already participant")
        after = (
            await s.execute(
                text(
                    """
                    SELECT kind, ref_id::text, role, left_at
                    FROM signal_participants
                    WHERE signal_id = :sig
                    ORDER BY joined_at
                    """
                ),
                {"sig": HOST},
            )
        ).fetchall()
        print("after:", after)


if __name__ == "__main__":
    asyncio.run(main())
