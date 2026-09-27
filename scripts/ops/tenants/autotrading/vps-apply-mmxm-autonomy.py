#!/usr/bin/env python3
"""Sync autotrading bootstrap to prod, reseeds stack, fixes bridge/MCP, smoke checks."""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))
LOCAL_ROOT = os.environ.get(
    "BOKITO_LOCAL_ROOT",
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "..")),
)
LINK_SIGNAL = os.environ.get("LINK_SIGNAL_ID", "847c0b0e-6bd3-440b-a352-bd1c32701667")


def connect() -> paramiko.SSHClient:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=KEY_PATH, timeout=30)
    return client


def run(client: paramiko.SSHClient, cmd: str, timeout: int = 300) -> tuple[int, str, str]:
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    code = stdout.channel.recv_exit_status()
    out = stdout.read().decode()
    err = stderr.read().decode()
    print(">>>", cmd[:140])
    if out:
        print(out[-4000:], end="" if out.endswith("\n") else "\n")
    if err.strip():
        print(err[-2000:], file=sys.stderr, end="" if err.endswith("\n") else "\n")
    return code, out, err


def sync_bootstrap(client: paramiko.SSHClient) -> None:
    api_dir = os.path.join(LOCAL_ROOT, "apps", "api")
    tar_path = tempfile.mktemp(suffix=".tar.gz")
    # Prefer Python tarfile for Windows compatibility.
    import tarfile

    with tarfile.open(tar_path, "w:gz") as tf:
        tf.add(
            os.path.join(api_dir, "scripts", "tenants", "autotrading"),
            arcname="scripts/tenants/autotrading",
        )
    sftp = client.open_sftp()
    remote_tar = "/tmp/bokito-autotrading-bootstrap.tar.gz"
    sftp.put(tar_path, remote_tar)
    sftp.close()
    os.remove(tar_path)
    run(
        client,
        f"cd /opt/bokito/apps/api && tar -xzf {remote_tar} && rm {remote_tar}",
        60,
    )
    run(
        client,
        "cid=$(cd /opt/bokito && docker compose -p bokito ps -q api); "
        "docker cp /opt/bokito/apps/api/scripts/tenants/autotrading/. "
        "$cid:/app/scripts/tenants/autotrading/",
        60,
    )


def seed_remote(client: paramiko.SSHClient) -> int:
    remote = f"""
cd /opt/bokito && docker compose -p bokito exec -T api python <<'PY'
import asyncio
from uuid import UUID
from sqlalchemy import select
from app.db.session import async_session_factory
from app.models.auth import Tenant
from app.models.agent import Agent
from app.models.trigger import Trigger
from scripts.tenants.autotrading.bootstrap import seed_trading_stack, STRATEGY_OPTIMIZER_SLUG

async def main():
    async with async_session_factory() as session:
        tenant = (await session.execute(select(Tenant).where(Tenant.slug == "autotrading"))).scalar_one()
        result = await seed_trading_stack(
            session, tenant.id, link_signal_id=UUID("{LINK_SIGNAL}")
        )
        print("SEED", result)
        opt = (await session.execute(
            select(Agent).where(Agent.tenant_id == tenant.id, Agent.slug == STRATEGY_OPTIMIZER_SLUG)
        )).scalar_one()
        print("optimizer", opt.id, opt.name, "active", opt.is_active)
        weekly = (await session.execute(
            select(Trigger).where(Trigger.tenant_id == tenant.id, Trigger.name == "Weekly strategy review")
        )).scalar_one()
        print("weekly_agent", weekly.agent_id, "enabled", weekly.enabled)
asyncio.run(main())
PY
"""
    code, _, _ = run(client, remote, 180)
    return code


def main() -> int:
    client = connect()
    print("Syncing autotrading bootstrap...")
    sync_bootstrap(client)
    print("Seeding trading stack...")
    code = seed_remote(client)
    if code != 0:
        client.close()
        return code

    # Bridge + MCP fixes (optional; webhook smoke may 500 while LLM loop is slow)
    if os.environ.get("SKIP_BRIDGE", "").strip() not in ("1", "true", "yes"):
        for script in (
            "vps-fix-trading-mcp-server.py",
            "vps-fix-trading-bokito-bridge.py",
        ):
            local = os.path.join(os.path.dirname(__file__), script)
            if os.path.isfile(local):
                print(f"Running {script}...")
                try:
                    subprocess.check_call([sys.executable, local], cwd=LOCAL_ROOT)
                except subprocess.CalledProcessError as exc:
                    print(f"{script} failed: {exc}", file=sys.stderr)

    # Audit triggers after seed
    run(
        client,
        """
cd /opt/bokito && docker compose -p bokito exec -T api python <<'PY'
import asyncio, json
from sqlalchemy import select
from app.db.session import async_session_factory
from app.models.auth import Tenant
from app.models.trigger import Trigger
from app.models.integration import McpServer

async def main():
    async with async_session_factory() as session:
        tenant = (await session.execute(select(Tenant).where(Tenant.slug == "autotrading"))).scalar_one()
        settings = json.loads(tenant.settings_json or "{}")
        print("autonomy_posture", settings.get("autonomy_posture"))
        print("trading_ops", settings.get("trading_ops"))
        reads = [k for k,v in (settings.get("tool_overrides") or {}).items() if "risk_status" in k]
        print("risk_status_override", reads, (settings.get("tool_overrides") or {}).get(reads[0] if reads else "", None))
        for t in (await session.execute(select(Trigger).where(Trigger.tenant_id == tenant.id))).scalars():
            print(f"trigger {t.name}: enabled={t.enabled} last={t.last_status} agent={t.agent_id}")
        for m in (await session.execute(select(McpServer).where(McpServer.tenant_id == tenant.id))).scalars():
            print(f"mcp {m.name}: {m.server_url}")
asyncio.run(main())
PY
""",
        120,
    )
    client.close()
    print("apply_mmxm_autonomy_done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
