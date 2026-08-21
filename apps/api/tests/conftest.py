import asyncio
import os
from typing import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlmodel import SQLModel

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("TRIGGER_SCHEDULER_ENABLED", "false")
os.environ.setdefault("BOKITO_MOCK_EXECUTION", "true")

from app.db.session import get_session  # noqa: E402
from app.main import app  # noqa: E402
from app.models import *  # noqa: E402, F401, F403
from scripts.seed import TEST_EMAIL, TEST_PASSWORD  # noqa: E402

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(autouse=True)
def _reset_rate_limits():
    from app.middleware.rate_limit import reset_rate_limits

    reset_rate_limits()
    yield
    reset_rate_limits()


@pytest_asyncio.fixture
async def session_override() -> AsyncGenerator[AsyncSession, None]:
    engine = create_async_engine(TEST_DATABASE_URL, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)
    factory = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        yield session
    await engine.dispose()


@pytest_asyncio.fixture
async def client(session_override: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    async def _override():
        yield session_override

    app.dependency_overrides[get_session] = _override

    from app.models.agent import Agent
    from app.models.auth import Membership, Tenant, User
    from app.models.channel import ChannelAccount
    from app.services.auth import hash_password

    tenant = Tenant(slug="test", name="Test Tenant")
    # Verified: the seeded operator must pass the soft verification gate on
    # outbound endpoints (reply, email send, mailbox connect).
    user = User(
        email=TEST_EMAIL,
        password_hash=hash_password(TEST_PASSWORD),
        display_name="Test",
        email_verified=True,
    )
    session_override.add(tenant)
    session_override.add(user)
    await session_override.commit()
    await session_override.refresh(tenant)
    await session_override.refresh(user)
    session_override.add(Membership(tenant_id=tenant.id, user_id=user.id, role="owner"))
    from app.models.inbox import InboxSettings

    session_override.add(InboxSettings(tenant_id=tenant.id))
    session_override.add(
        Agent(
            tenant_id=tenant.id,
            name="Test Assistant",
            role="assistant",
            slug="assistant",
            runtime_status="standby",
            system_prompt="Test assistant",
        )
    )
    session_override.add(
        Agent(
            tenant_id=tenant.id,
            name="Test Orchestra",
            role="orchestra",
            slug="orchestra",
            runtime_status="standby",
            system_prompt="Test orchestra agent",
        )
    )
    # Use a connectable provider: the email settings API hides mock accounts.
    session_override.add(
        ChannelAccount(
            tenant_id=tenant.id,
            channel="email",
            address="support@test.local",
            provider="outlook",
        )
    )
    from app.services.workspace import upsert_doc

    await upsert_doc(
        session_override,
        tenant.id,
        path="company.md",
        content="# Company\n\nTest tenant overview.",
        kind="doc",
        created_by_type="system",
        commit=False,
    )
    await session_override.commit()

    from unittest.mock import AsyncMock

    import app.main as main_module

    main_module.init_db = AsyncMock()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()
