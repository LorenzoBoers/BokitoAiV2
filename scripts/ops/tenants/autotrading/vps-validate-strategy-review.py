#!/usr/bin/env python3
"""Start MMXM strategy review workstream on prod and verify task created."""
import os
import sys

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))

REMOTE = r"""
cd /opt/bokito && docker compose -p bokito exec -T api python <<'PY'
import asyncio, json
from sqlalchemy import select
from app.db.session import async_session_factory
from app.models.auth import Tenant
from app.models.orchestra import Workstream
from app.models.orchestration import AgentTask
from app.models.trigger import Trigger
from app.services.triggers import fire_trigger

async def main():
    async with async_session_factory() as session:
        tenant = (await session.execute(select(Tenant).where(Tenant.slug == "autotrading"))).scalar_one()
        trigger = (
            await session.execute(
                select(Trigger).where(
                    Trigger.tenant_id == tenant.id,
                    Trigger.name == "Weekly strategy review",
                )
            )
        ).scalar_one()
        result = await fire_trigger(session, trigger)
        print("fire_trigger", json.dumps(result))
        task_id = result.get("task_id")
        if task_id:
            task = await session.get(AgentTask, task_id)
            if task:
                print("task_status", task.status, "workstream_id", str(task.workstream_id))
        ws = (
            await session.execute(
                select(Workstream).where(
                    Workstream.tenant_id == tenant.id,
                    Workstream.name == "MMXM strategy review",
                )
            )
        ).scalar_one()
        print("workstream_id", str(ws.id), "steps_enabled", ws.enabled)
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
    return 0 if "task_id" in out or "started" in out else 1


if __name__ == "__main__":
    raise SystemExit(main())
