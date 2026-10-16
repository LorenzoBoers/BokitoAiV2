"""Force Extra pass on Ask so UI shows 'heeft overgeslagen' (U22/U32 live assist)."""
from __future__ import annotations

import asyncio
import json
from uuid import UUID

from sqlalchemy import text

from app.db.session import async_session_factory

SID = UUID("84c74f47-51bd-476c-ac12-4fcf1ac6f912")
ORCH = UUID("cc965b16-aff8-44a2-a0ea-29ebd4e5bccf")
EXTRA = UUID("a2e4837d-3d58-4327-8f43-7d585d3948ce")


async def main() -> None:
    from app.models.signal import Signal
    from app.services.participant_turns import request_participant_turn, clear_active_turn
    from app.models.signal import SignalEvent

    async with async_session_factory() as s:
        sig = await s.get(Signal, SID)
        if not sig:
            print("no signal")
            return
        # Clear any stuck floor first
        clear_active_turn(sig, reset_streak=True)
        await s.flush()

        req = await request_participant_turn(
            s,
            sig,
            member_kind="agent",
            member_ref_id=EXTRA,
            prompt="QA U22 force: reply with exactly: pass",
            requested_by_kind="agent",
            requested_by_id=ORCH,
            run=True,
            enqueue=True,
            defer_peer=False,
            deadline_s=90,
        )
        await s.commit()
        print("requested", json.dumps(req, default=str)[:500])


asyncio.run(main())
