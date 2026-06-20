#!/usr/bin/env python3
"""Update MMXM Trader + webhook trigger prompts for live DeGiro execution."""
import os
import sys

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))

REMOTE = r"""
cd /opt/bokito && docker compose -p bokito exec -T api python <<'PY'
import asyncio
from uuid import UUID
from sqlalchemy import select
from app.db.session import async_session_factory
from app.models.auth import Tenant
from app.models.agent import Agent
from app.models.trigger import Trigger

TRADER_ID = UUID("e1728c7f-f06d-4ea3-bbe7-1f7781ee9c25")
TRIGGER_NAME = "MMXM pipeline webhook"
LIVE_PROMPT = (
    "You are MMXM Trader, the autotrading execution agent for this workspace.\n\n"
    "Live DeGiro execution is ENABLED when risk_status reports execution_mode live "
    "and degiro_allow_live_orders true.\n"
    "Use trading MCP tools for every decision: risk_status first, then get_setup, "
    "get_trade_plan, get_market_context.\n\n"
    "Entry rules (enforced by risk governor):\n"
    "- AM window NY 09:45-11:15 when session_window_only is true\n"
    "- Max 3 trades/day, 1 open position, SMT required for live entries\n"
    "- Never bypass kill_switch\n\n"
    "On webhook kind decide: place_live_order when setup passes and caps allow.\n"
    "On kind manage: update_stop or flatten as appropriate.\n\n"
    "Always state execution_mode, caps snapshot, and blockers. Be concise."
)
INSTRUCTIONS = (
    "Live MMXM pipeline webhook.\n"
    "1. Call risk_status first. place_live_order only when live + degiro_allow_live_orders.\n"
    "2. kind decide: validate via get_setup/get_trade_plan; enter or skip with reason.\n"
    "3. kind manage: update_stop or flatten when warranted.\n"
    "4. Respect AM window, max trades/day, SMT, kill switch.\n"
    "Report execution_mode and blockers every time."
)

async def main():
    async with async_session_factory() as session:
        tenant = (
            await session.execute(select(Tenant).where(Tenant.slug == "autotrading"))
        ).scalar_one_or_none()
        if not tenant:
            print("tenant missing")
            return
        trader = await session.get(Agent, TRADER_ID)
        if trader:
            trader.system_prompt = LIVE_PROMPT
            session.add(trader)
        trig = (
            await session.execute(
                select(Trigger).where(
                    Trigger.tenant_id == tenant.id,
                    Trigger.name == TRIGGER_NAME,
                )
            )
        ).scalar_one_or_none()
        if trig:
            trig.instructions = INSTRUCTIONS
            session.add(trig)
        await session.commit()
        print("updated trader prompt + webhook instructions for live")

asyncio.run(main())
PY
"""


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=KEY_PATH, timeout=30)
    _, stdout, stderr = client.exec_command(REMOTE, timeout=120)
    out = stdout.read().decode()
    err = stderr.read().decode()
    if out:
        print(out, end="" if out.endswith("\n") else "\n")
    if err:
        print(err, file=sys.stderr, end="" if err.endswith("\n") else "\n")
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
