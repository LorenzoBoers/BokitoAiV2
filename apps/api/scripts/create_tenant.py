"""Create a workspace tenant for an existing user (minimal bootstrap only)."""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select

from app.db.session import async_session_factory, init_db
from app.models.auth import Tenant, User
from app.services.workspaces_portal import create_workspace


async def main() -> None:
    parser = argparse.ArgumentParser(description="Create a Bokito tenant for an existing user")
    parser.add_argument("--email", help="Owner email (defaults to first non-staff user)")
    parser.add_argument("--name", default="Autotrading", help="Tenant display name")
    parser.add_argument("--subdomain", default="autotrading", help="Tenant slug/subdomain")
    args = parser.parse_args()

    await init_db()
    async with async_session_factory() as session:
        if args.email:
            result = await session.execute(select(User).where(User.email == args.email))
            user = result.scalar_one_or_none()
            if not user:
                raise SystemExit(f"User not found: {args.email}")
        else:
            result = await session.execute(
                select(User).where(User.is_staff.is_(False)).order_by(User.created_at)
            )
            users = result.scalars().all()
            if not users:
                raise SystemExit("No users found in database")
            user = users[0]
            print(f"Using first user: {user.email}")

        existing = await session.execute(select(Tenant).where(Tenant.slug == args.subdomain))
        if existing.scalar_one_or_none():
            raise SystemExit(f"Tenant slug already exists: {args.subdomain}")

        workspace = await create_workspace(
            session,
            user,
            name=args.name,
            subdomain=args.subdomain,
        )
        print(f"Created tenant slug={workspace['slug']} name={workspace['name']} owner={user.email}")


if __name__ == "__main__":
    asyncio.run(main())
