#!/usr/bin/env python3
"""Create autotrading tenant on production VPS for an existing user."""
import os
import sys
import textwrap

import paramiko

HOST = os.environ.get("VPS_HOST", "31.97.45.44")
KEY_PATH = os.environ.get("VPS_SSH_KEY", os.path.expanduser("~/.ssh/bokito_vps_deploy"))
OWNER_EMAIL = os.environ.get("TENANT_OWNER_EMAIL", "")
TENANT_NAME = os.environ.get("TENANT_NAME", "Autotrading")
TENANT_SLUG = os.environ.get("TENANT_SLUG", "autotrading")


REMOTE_PY = textwrap.dedent(
    """
    import asyncio
    import os
    import sys

    sys.path.insert(0, "/app")
    os.chdir("/app")

    from sqlalchemy import select

    from app.db.session import async_session_factory, init_db
    from app.models.auth import Tenant, User
    from app.services.workspaces_portal import create_workspace

    OWNER_EMAIL = {owner_email!r}
    TENANT_NAME = {tenant_name!r}
    TENANT_SLUG = {tenant_slug!r}

    async def main():
        await init_db()
        async with async_session_factory() as session:
            if OWNER_EMAIL:
                user = (
                    await session.execute(select(User).where(User.email == OWNER_EMAIL))
                ).scalar_one_or_none()
                if not user:
                    raise SystemExit(f"User not found: {{OWNER_EMAIL}}")
            else:
                users = (
                    await session.execute(
                        select(User).where(User.is_staff.is_(False)).order_by(User.created_at)
                    )
                ).scalars().all()
                if not users:
                    raise SystemExit("No users found")
                user = users[0]
                print(f"Using owner: {{user.email}}")

            existing = (
                await session.execute(select(Tenant).where(Tenant.slug == TENANT_SLUG))
            ).scalar_one_or_none()
            if existing:
                print(f"Tenant already exists: slug={{existing.slug}} name={{existing.name}}")
                return

            ws = await create_workspace(
                session,
                user,
                name=TENANT_NAME,
                subdomain=TENANT_SLUG,
            )
            print(f"Created tenant slug={{ws['slug']}} name={{ws['name']}} owner={{user.email}}")

    asyncio.run(main())
    """
)


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username="root", key_filename=KEY_PATH, timeout=30)

    list_users_cmd = (
        "docker exec bokito-postgres-1 psql -U bokito -d bokito "
        "-t -A -c 'SELECT email FROM users ORDER BY created_at;'"
    )
    _, stdout, _ = client.exec_command(list_users_cmd, timeout=60)
    users = [line.strip() for line in stdout.read().decode().splitlines() if line.strip()]
    print("Users:", ", ".join(users))

    slug_check_cmd = (
        "docker exec bokito-postgres-1 psql -U bokito -d bokito "
        "-t -A -c \"SELECT slug FROM tenants WHERE slug='autotrading';\""
    )
    _, stdout, _ = client.exec_command(slug_check_cmd, timeout=60)
    if stdout.read().decode().strip():
        print("Tenant autotrading already exists.")
        client.close()
        return 0

    owner = OWNER_EMAIL
    if not owner:
        non_staff = [u for u in users if u not in ("staff@bokito.ai",)]
        owner = non_staff[0] if non_staff else users[0]
        print(f"Selected owner: {owner}")

    script = REMOTE_PY.format(owner_email=owner, tenant_name=TENANT_NAME, tenant_slug=TENANT_SLUG)
    remote_path = "/tmp/create_autotrading_tenant.py"
    container_path = "/app/scripts/create_autotrading_tenant.py"
    sftp = client.open_sftp()
    with sftp.file(remote_path, "w") as f:
        f.write(script)
    sftp.close()

    for cmd in (
        f"docker cp {remote_path} bokito-api-1:{container_path}",
        f"docker exec bokito-api-1 python {container_path}",
    ):
        _, stdout, stderr = client.exec_command(cmd, timeout=120)
        out = stdout.read().decode()
        err = stderr.read().decode()
        code = stdout.channel.recv_exit_status()
        if out:
            print(out, end="" if out.endswith("\n") else "\n")
        if err:
            print(err, file=sys.stderr, end="" if err.endswith("\n") else "\n")
        if code != 0:
            client.close()
            return code
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
