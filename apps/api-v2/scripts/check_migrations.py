"""Fail when the SQLAlchemy models drift from the Alembic head.

Resets the `public` schema of DATABASE_URL (a throwaway database: CI service
container or embedded pgserver), runs `alembic upgrade head`, then autogenerates
a diff. Any pending operation means a migration is missing.
"""

from __future__ import annotations

import asyncio
import subprocess
import sys

from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext
from sqlalchemy import text

from bokito.db import get_engine
from bokito.domain import Base


async def _reset_schema() -> None:
    """Drop everything pytest or an earlier run left behind; migrations start from zero."""
    engine = get_engine()
    async with engine.begin() as conn:
        await conn.execute(text("DROP SCHEMA public CASCADE"))
        await conn.execute(text("CREATE SCHEMA public"))
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    await engine.dispose()


def _upgrade() -> None:
    subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], check=True)


async def _drift() -> list:
    engine = get_engine()
    async with engine.connect() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))

        def _diff(sync_conn):  # type: ignore[no-untyped-def]
            ctx = MigrationContext.configure(sync_conn, opts={"compare_type": True})
            return compare_metadata(ctx, Base.metadata)

        diff = await conn.run_sync(_diff)
    await engine.dispose()
    return diff


def main() -> int:
    asyncio.run(_reset_schema())
    _upgrade()
    diff = asyncio.run(_drift())
    if diff:
        print("Model/migration drift detected:")
        for op in diff:
            print(" -", op)
        return 1
    print("Migrations match models.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
