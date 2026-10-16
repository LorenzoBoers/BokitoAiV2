"""Full U10 tool activity + any QA U10 decisions tenant-wide."""
from __future__ import annotations

import asyncio
import json
from uuid import UUID

from sqlalchemy import text

from app.db.session import async_session_factory

SID = UUID("84c74f47-51bd-476c-ac12-4fcf1ac6f912")


async def main() -> None:
    async with async_session_factory() as s:
        row = (
            await s.execute(
                text(
                    """
                    SELECT metadata_json
                    FROM signal_messages
                    WHERE signal_id = :sid AND kind = 'agent_message'
                      AND created_at > '2026-10-15 20:29:00'
                    ORDER BY created_at DESC LIMIT 1
                    """
                ),
                {"sid": str(SID)},
            )
        ).fetchone()
        meta = json.loads(row[0] or "{}") if row else {}
        for a in meta.get("activity") or []:
            if a.get("tool") == "create_decision_request" or "decision" in str(a.get("label", "")).lower():
                print("ACTIVITY", json.dumps(a, indent=2, default=str)[:2500])
        print("--- all recent decision_requests with U10 / Mag ik ---")
        decs = (
            await s.execute(
                text(
                    """
                    SELECT id, signal_id, status, title, left(summary,120),
                           left(options_json::text,400), message_id, created_at, run_id, bundle_id
                    FROM decision_requests
                    WHERE created_at > now() - interval '2 hours'
                      AND (title ILIKE '%U10%' OR title ILIKE '%afronden%'
                           OR summary ILIKE '%U10%' OR options_json::text ILIKE '%\"ja\"%')
                    ORDER BY created_at DESC
                    LIMIT 20
                    """
                )
            )
        ).fetchall()
        for d in decs:
            print(d)
        print("--- last 15 decision_requests any ---")
        recent = (
            await s.execute(
                text(
                    """
                    SELECT id, signal_id, status, title, created_at, message_id
                    FROM decision_requests
                    WHERE created_at > now() - interval '2 hours'
                    ORDER BY created_at DESC
                    LIMIT 15
                    """
                )
            )
        ).fetchall()
        for d in recent:
            print(d)
        print("--- agent runs for signal ---")
        runs = (
            await s.execute(
                text(
                    """
                    SELECT id, status, started_at, finished_at, left(coalesce(error,''),200),
                           left(coalesce(result_json::text,''),400)
                    FROM agent_runs
                    WHERE signal_id = :sid
                    ORDER BY started_at DESC LIMIT 5
                    """
                ),
                {"sid": str(SID)},
            )
        ).fetchall()
        for r in runs:
            print(r)


if __name__ == "__main__":
    asyncio.run(main())
