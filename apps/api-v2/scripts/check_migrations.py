"""Fail when the SQLAlchemy models drift from the Alembic head.

Runs `alembic upgrade head` against DATABASE_URL, then autogenerates a diff.
Any pending operation means a migration is missing.
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
