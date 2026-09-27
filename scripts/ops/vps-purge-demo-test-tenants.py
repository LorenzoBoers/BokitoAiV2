#!/usr/bin/env python3
"""Purge demo/e2e/test tenants (and orphaned users) on prod.

Keeps real workspaces plus one test tenant (`demo`) and its owner account.
Dry-run by default; pass --apply to delete.
"""
from __future__ import annotations

import os
import sys

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))
APPLY = "--apply" in sys.argv

KEEP_SLUGS = frozenset(
    {
        "bokito",
        "autotrading",
        "bourgondienadvies",
        "kadeso",
        "demo",  # single test environment for future checks
    }
)

# Product / ops accounts that must survive even without a current membership.
KEEP_EMAILS = frozenset(
    {
        "trader@bokito.ai",
        "owner@demo.local",
    }
)

REMOTE = f"""
cd /opt/bokito && docker compose -p bokito exec -T api python <<'PY'
import asyncio
from sqlalchemy import select, func, delete as sa_delete
from app.db.session import async_session_factory
from app.models.auth import Tenant, User, Membership
from app.models.staff import StaffAccessLog
from sqlalchemy import text
from app.services.workspaces_portal import delete_workspace

KEEP = set({sorted(KEEP_SLUGS)!r})
KEEP_EMAILS = set({sorted(KEEP_EMAILS)!r})
APPLY = {APPLY!r}

async def purge_tenant(session, tenant):
    # Prod may still have the pre-cycle-break delete_workspace; null FKs first.
    tid = tenant.id
    await session.execute(
        text(
            "UPDATE decision_requests "
            "SET platform_change_id = NULL, signal_id = NULL, notification_id = NULL "
            "WHERE tenant_id = :tid"
        ),
        {{"tid": tid}},
    )
    await session.execute(
        text("UPDATE platform_changes SET decision_id = NULL WHERE tenant_id = :tid"),
        {{"tid": tid}},
    )
    await session.execute(
        text(
            "UPDATE signal_messages SET decision_id = NULL "
            "WHERE signal_id IN (SELECT id FROM signals WHERE tenant_id = :tid)"
        ),
        {{"tid": tid}},
    )
    await session.commit()
    await delete_workspace(session, tenant)

async def list_plan(session):
    tenants = (await session.execute(select(Tenant).order_by(Tenant.slug))).scalars().all()
    print("TENANTS:")
    doomed_tenants = []
    for t in tenants:
        n = (
            await session.execute(
                select(func.count()).select_from(Membership).where(Membership.tenant_id == t.id)
            )
        ).scalar()
        if t.slug in KEEP:
            print(f"  [KEEP]   {{t.slug:30}} members={{n}} name={{t.name}}")
        else:
            print(f"  [DELETE] {{t.slug:30}} members={{n}} name={{t.name}}")
            doomed_tenants.append(t)

    doomed_ids = {{t.id for t in doomed_tenants}}
    users = (await session.execute(select(User).order_by(User.email))).scalars().all()
    print("USERS:")
    doomed_users = []
    for u in users:
        mems = (
            await session.execute(
                select(Membership, Tenant)
                .join(Tenant, Tenant.id == Membership.tenant_id)
                .where(Membership.user_id == u.id)
            )
        ).all()
        slugs = [t.slug for _m, t in mems]
        tenant_ids = {{t.id for _m, t in mems}}
        email = (u.email or "").lower()
        if u.is_staff:
            print(f"  [KEEP-staff] {{u.email:40}} tenants={{slugs}}")
            continue
        if email in KEEP_EMAILS:
            print(f"  [KEEP]       {{u.email:40}} tenants={{slugs}}")
            continue
        if any(s in KEEP for s in slugs):
            print(f"  [KEEP]       {{u.email:40}} tenants={{slugs}}")
            continue
        if not tenant_ids or tenant_ids <= doomed_ids:
            print(f"  [DELETE]     {{u.email:40}} tenants={{slugs}}")
            doomed_users.append(u)
        else:
            print(f"  [KEEP]       {{u.email:40}} tenants={{slugs}}")
    return doomed_tenants, doomed_users

async def main():
    async with async_session_factory() as session:
        doomed_tenants, doomed_users = await list_plan(session)
        doomed_pairs = [(t.id, t.slug) for t in doomed_tenants]
        if not APPLY:
            print()
            print(
                f"Dry-run only. Would delete {{len(doomed_tenants)}} tenants "
                f"and {{len(doomed_users)}} users."
            )
            print("Re-run with --apply to purge.")
            return

    for tid, slug in doomed_pairs:
        print(f"Purging tenant {{slug}}...")
        async with async_session_factory() as session:
            fresh = (
                await session.execute(select(Tenant).where(Tenant.id == tid))
            ).scalar_one_or_none()
            if fresh is None:
                print(f"  already gone: {{slug}}")
                continue
            await purge_tenant(session, fresh)

    async with async_session_factory() as session:
        keep_ids = {{
            row.id
            for row in (
                await session.execute(select(Tenant).where(Tenant.slug.in_(list(KEEP))))
            ).scalars().all()
        }}
        users = (await session.execute(select(User).order_by(User.email))).scalars().all()
        removed = 0
        for u in users:
            if u.is_staff:
                continue
            if (u.email or "").lower() in KEEP_EMAILS:
                continue
            mem_ids = {{
                m.tenant_id
                for m in (
                    await session.execute(select(Membership).where(Membership.user_id == u.id))
                ).scalars().all()
            }}
            if mem_ids & keep_ids:
                continue
            await session.execute(
                sa_delete(StaffAccessLog).where(StaffAccessLog.staff_user_id == u.id)
            )
            # Sessions / tokens may reference the user; wipe common auth tables by user_id.
            for table_name in ("sessions", "auth_tokens", "refresh_tokens"):
                table = None
                try:
                    from sqlmodel import SQLModel
                    table = SQLModel.metadata.tables.get(table_name)
                except Exception:
                    table = None
                if table is not None and "user_id" in table.c:
                    await session.execute(sa_delete(table).where(table.c.user_id == u.id))
            await session.delete(u)
            removed += 1
            print(f"Deleted user {{u.email}}")
        await session.commit()
        left = (await session.execute(select(Tenant).order_by(Tenant.slug))).scalars().all()
        print("REMAINING TENANTS:")
        for t in left:
            print(f"  {{t.slug}}  {{t.name}}")
        print(f"Done. Removed {{len(doomed_pairs)}} tenants and {{removed}} users.")

asyncio.run(main())
PY
"""


def main() -> int:
    if not os.path.exists(KEY_PATH):
        print(f"SSH key not found: {KEY_PATH}", file=sys.stderr)
        return 1
    mode = "APPLY" if APPLY else "DRY-RUN"
    print(f"Connecting to {HOST} ({mode})...")
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=KEY_PATH, timeout=30)
    _, stdout, stderr = client.exec_command(REMOTE, timeout=600)
    out = stdout.read().decode()
    err = stderr.read().decode()
    client.close()
    if out:
        print(out, end="" if out.endswith("\n") else "\n")
    if err:
        filtered = "\n".join(
            line
            for line in err.splitlines()
            if "SAWarning" not in line and "level=warning" not in line.lower()
        )
        if filtered.strip():
            print(filtered, file=sys.stderr, end="" if filtered.endswith("\n") else "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
