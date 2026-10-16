"""Diagnose schema + Ask path for U-suite probes."""
from __future__ import annotations

import asyncio
import json
import sys

import httpx
from sqlalchemy import text

from app.db.session import async_session_factory

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8010"
TID = "14cb3ae9-c892-458b-9e71-05f093d5aa47"


async def db() -> None:
    async with async_session_factory() as s:
        cols = (
            await s.execute(
                text(
                    """
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_name = 'signals'
                      AND (
                        column_name LIKE '%turn%'
                        OR column_name LIKE '%handoff%'
                        OR column_name LIKE '%floor%'
                        OR column_name IN ('status', 'channel', 'subject')
                      )
                    ORDER BY column_name
                    """
                )
            )
        ).fetchall()
        print("signal_cols", [c[0] for c in cols])
        row = (
            await s.execute(
                text(
                    "SELECT id::text, status, channel, subject "
                    "FROM signals WHERE id = :id"
                ),
                {"id": TID},
            )
        ).first()
        print("host_row", row)
        ver = (
            await s.execute(text("SELECT version_num FROM alembic_version"))
        ).fetchall()
        print("alembic", ver)


async def api() -> None:
    async with httpx.AsyncClient(base_url=BASE, timeout=60.0) as c:
        login = await c.post(
            "/api/auth/login",
            json={"email": "admin@bokito.ai", "password": "bokito-test-password"},
        )
        print("login", login.status_code)
        token = login.json()["access_token"]
        h = {"Authorization": f"Bearer {token}"}
        th = await c.get(f"/api/signals/{TID}", headers=h)
        print("get_thread", th.status_code, list((th.json() or {}).keys())[:20] if th.status_code == 200 else th.text[:200])
        if th.status_code == 200:
            d = th.json()
            print(
                "status",
                d.get("status"),
                "participants",
                len(d.get("participants") or []),
                "handoff",
                bool(d.get("handoff_session")),
                "active_turn",
                d.get("active_turn"),
            )
        for path in (
            f"/api/signals/conversations/{TID}/stream",
            f"/api/signals/{TID}/stream",
            f"/api/signals/{TID}/chat/stream",
        ):
            r = await c.post(path, headers=h, json={"content": "diag ping"})
            print("POST", path, r.status_code, r.text[:180].replace("\n", " "))


async def main() -> None:
    await db()
    await api()


if __name__ == "__main__":
    sys.path.insert(0, "/opt/bokito-dev/apps/api")
    asyncio.run(main())
