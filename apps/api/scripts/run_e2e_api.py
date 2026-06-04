"""Seed a local SQLite DB and run the API for Playwright e2e (mock LLM)."""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
E2E_DB = ROOT / "e2e-dev.db"

if E2E_DB.exists():
    E2E_DB.unlink()

os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{E2E_DB.as_posix().replace(chr(92), '/')}"
os.environ.setdefault("LLM_MODE", "mock")
os.environ.setdefault("JWT_SECRET", "e2e-jwt-secret")
os.environ.setdefault(
    "CORS_ORIGINS",
    "http://127.0.0.1:5174,http://127.0.0.1:5175,http://127.0.0.1:5184,http://127.0.0.1:5185,"
    "http://localhost:5174,http://localhost:5175,http://localhost:5184,http://localhost:5185",
)

sys.path.insert(0, str(ROOT))


async def _prepare() -> None:
    from app.db.session import init_db
    from scripts.seed import seed

    await init_db()
    await seed()


def main() -> None:
    port = os.environ.get("PORT", "8008")
    asyncio.run(_prepare())
    subprocess.run(
        [
            sys.executable,
            "-m",
            "uvicorn",
            "app.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            port,
        ],
        cwd=ROOT,
        check=True,
    )


if __name__ == "__main__":
    main()
