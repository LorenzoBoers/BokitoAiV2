import asyncio
from collections.abc import AsyncGenerator
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlmodel import SQLModel

from app.config import get_settings

settings = get_settings()
_engine_kwargs: dict = {"echo": settings.debug, "pool_pre_ping": True}
_db_url = settings.database_url or ""
if "sqlite" in _db_url:
    # Default sqlite wait is 5s. E2e seeds in the parent process, then uvicorn
    # migrates the same file; a leftover pool connection used to fail startup.
    _engine_kwargs["connect_args"] = {"timeout": 30}
    if ":memory:" in _db_url:
        # Each pooled connection would otherwise get its own empty memory DB,
        # so create_all then reclaim/seed on a later checkout see no tables and
        # TestClient lifespan can hang under CI load.
        from sqlalchemy.pool import StaticPool

        _engine_kwargs["connect_args"]["check_same_thread"] = False
        _engine_kwargs["poolclass"] = StaticPool
if "postgresql" in _db_url:
    # SSE routes used to hold a checked-out connection for the whole stream.
    # Give the in-process chat drive room, and fail checkout instead of hanging.
    _engine_kwargs.update(pool_size=20, max_overflow=20, pool_timeout=10)
engine = create_async_engine(settings.database_url, **_engine_kwargs)
async_session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

# Serializes concurrent startup migrations (api + worker booting together).
_MIGRATION_LOCK_KEY = 729_001


def _assert_no_schema_drift(sync_conn) -> None:
    """Fail fast when a model column has no matching column in the live schema.

    Postgres is Alembic-managed; a model change without a revision otherwise
    surfaces as opaque 500s on every select of that table (all backend tests
    run on SQLite, where create_all/schema_patch mask the gap). Raising here
    makes the deploy smoke test fail and triggers the automatic rollback.
    """
    from sqlalchemy import inspect

    inspector = inspect(sync_conn)
    drift: list[str] = []
    for table_name, table in SQLModel.metadata.tables.items():
        if not inspector.has_table(table_name):
            drift.append(f"{table_name} (table missing)")
            continue
        existing = {c["name"] for c in inspector.get_columns(table_name)}
        drift.extend(
            f"{table_name}.{col.name}" for col in table.columns if col.name not in existing
        )
    if drift:
        raise RuntimeError(
            "Database schema is behind the models; write an Alembic revision for: "
            + ", ".join(sorted(drift))
        )


def _alembic_upgrade_head() -> None:
    """Run `alembic upgrade head` in-process (called from a worker thread).

    env.py starts its own event loop via `asyncio.run`, so this must never be
    called from a running loop directly — use `asyncio.to_thread`.
    """
    from alembic import command
    from alembic.config import Config

    api_root = Path(__file__).resolve().parents[2]
    config = Config(str(api_root / "alembic.ini"))
    config.set_main_option("script_location", str(api_root / "alembic"))
    command.upgrade(config, "head")


async def init_db() -> None:
    import app.models  # noqa: F401 — register all SQLModel tables on the metadata

    if engine.dialect.name == "postgresql":
        # Postgres schema is Alembic-managed. An advisory lock serializes the
        # api and worker containers when they boot at the same time.
        async with engine.connect() as conn:
            await conn.execute(text("SELECT pg_advisory_lock(:key)"), {"key": _MIGRATION_LOCK_KEY})
            try:
                await asyncio.to_thread(_alembic_upgrade_head)
            finally:
                await conn.execute(
                    text("SELECT pg_advisory_unlock(:key)"), {"key": _MIGRATION_LOCK_KEY}
                )
            await conn.run_sync(_assert_no_schema_drift)
    else:
        # SQLite (tests/local dev without Postgres): create_all plus the frozen
        # schema patches — no Alembic, matching the historical behavior.
        from app.db.ai_handling_converge import converge_sqlite
        from app.db.schema_patch import apply_column_patches, apply_data_repairs
        from app.db.sqlite_converge import converge_sqlite_schema

        async with engine.begin() as conn:
            await conn.run_sync(SQLModel.metadata.create_all)
            await conn.run_sync(apply_column_patches)
            await conn.run_sync(apply_data_repairs)
            await conn.run_sync(converge_sqlite)
            await conn.run_sync(converge_sqlite_schema)

    from app.services.integration_catalog_store import ensure_catalog_fresh
    from app.services.lead_agent import ensure_lead_agents
    from app.services.model_catalog import seed_model_catalog
    from app.services.personal_agents import deactivate_personal_agents
    from app.services.personal_assistant import ensure_personal_assistants
    from app.services.platform_watch import ensure_platform_watch
    from app.services.tenant_bootstrap import ensure_front_desks

    async with async_session_factory() as session:
        await seed_model_catalog(session)
        await ensure_catalog_fresh(session)
        await deactivate_personal_agents(session)
        await ensure_front_desks(session)
        await ensure_lead_agents(session)
        # Platform-owned Bokito helper per tenant; also refreshes its prompt
        # and passport so a shipped improvement reaches every workspace.
        await ensure_personal_assistants(session)
        await ensure_platform_watch(session)
        from app.services.thread_schedule import ensure_rule_threads

        await ensure_rule_threads(session)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_factory() as session:
        yield session
