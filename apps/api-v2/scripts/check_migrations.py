"""Fail when the SQLAlchemy models drift from the Alembic head.

Runs `alembic upgrade head` against DATABASE_URL, then autogenerates a diff.
Any pending operation means a migration is missing.
"""

from __future__ import annotations

import asyncio
import sys

from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from sqlalchemy import text

from alembic import command
from bokito.config import get_settings
from bokito.db import get_engine
from bokito.domain import Base


async def main() -> int:
    settings = get_settings()
    cfg = Config("alembic.ini")
    cfg.set_main_option("sqlalchemy.url", settings.database_url)
    command.upgrade(cfg, "head")

    engine = get_engine()
    async with engine.connect() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))

        def _diff(sync_conn):  # type: ignore[no-untyped-def]
            ctx = MigrationContext.configure(sync_conn, opts={"compare_type": True})
            return compare_metadata(ctx, Base.metadata)

        diff = await conn.run_sync(_diff)
    await engine.dispose()

    if diff:
        print("Model/migration drift detected:")
        for op in diff:
            print(" -", op)
        return 1
    print("Migrations match models.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
