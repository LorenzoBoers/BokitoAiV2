from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlmodel import SQLModel

from app.config import get_settings

settings = get_settings()
engine = create_async_engine(settings.database_url, echo=settings.debug, pool_pre_ping=True)
async_session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def init_db() -> None:
    import app.models  # noqa: F401 — register all SQLModel tables before create_all
    from app.db.schema_patch import apply_column_patches, apply_data_repairs

    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
        await conn.run_sync(apply_column_patches)
        await conn.run_sync(apply_data_repairs)

    from app.services.personal_agents import provision_missing_personal_agents

    async with async_session_factory() as session:
        await provision_missing_personal_agents(session)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_factory() as session:
        yield session
