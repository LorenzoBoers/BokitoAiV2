"""Greenfield database reset: DROP all tables, recreate, and reseed.

DESTRUCTIVE. Intended for local dev / greenfield rebuilds.

Usage (PowerShell):
    $env:DATABASE_URL="sqlite+aiosqlite:///./dev.db"; .\.venv\Scripts\python.exe scripts/reset_db.py
"""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlmodel import SQLModel  # noqa: E402

import app.models  # noqa: E402, F401  — register all tables
from app.config import get_settings  # noqa: E402
from app.db.session import engine  # noqa: E402
from scripts.seed import seed  # noqa: E402


async def reset() -> None:
    settings = get_settings()
    print(f"Resetting database: {settings.database_url}")
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.drop_all)
        await conn.run_sync(SQLModel.metadata.create_all)
    print("Schema dropped and recreated. Seeding...")
    await seed()
    print("Database reset and reseeded.")


if __name__ == "__main__":
    asyncio.run(reset())
