#!/usr/bin/env python3
"""Audit autotrading tenant: agents, projects, signal linkage, MCP."""
import os
import sys

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))
THREAD_ID = os.environ.get("THREAD_ID", "847c0b0e-6bd3-440b-a352-bd1c32701667")

REMOTE = f"""
cd /opt/bokito && docker compose -p bokito exec -T api python <<'PY'
import asyncio
from uuid import UUID
from sqlalchemy import select
from app.db.session import async_session_factory
from app.models.auth import Tenant
from app.models.agent import Agent
from app.models.project import Project
from app.models.signal import Signal

THREAD_ID = UUID("{THREAD_ID}")

async def main():
    async with async_session_factory() as session:
        tenant = (
            await session.execute(select(Tenant).where(Tenant.slug == "autotrading"))
        ).scalar_one_or_none()
        if not tenant:
            print("tenant autotrading: NOT FOUND")
            return
        print("tenant_id:", tenant.id)
        agents = (
            await session.execute(select(Agent).where(Agent.tenant_id == tenant.id))
        ).scalars().all()
        print("agents:")
        for a in agents:
            print(f"  - {{a.name}} role={{a.role}} id={{a.id}} active={{a.is_active}} model={{a.model}}")
        projects = (
            await session.execute(select(Project).where(Project.tenant_id == tenant.id))
        ).scalars().all()
        print("projects:")
        for p in projects:
            print(f"  - {{p.name}} id={{p.id}} po_agent_id={{p.po_agent_id}}")
        sig = await session.get(Signal, THREAD_ID)
        if sig:
            print("signal:", {{
                "id": str(sig.id),
                "project_id": str(sig.project_id) if sig.project_id else None,
                "agent_id": str(sig.agent_id) if sig.agent_id else None,
                "channel": sig.channel,
            }})

asyncio.run(main())
PY
docker compose -p bokito exec -T postgres psql -U bokito -d bokito -c "SELECT slug, provider_type FROM integration_connections LIMIT 20;" 2>/dev/null || true
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
