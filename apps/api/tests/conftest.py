import asyncio
import json
import os
from typing import AsyncGenerator
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlmodel import SQLModel

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("TRIGGER_SCHEDULER_ENABLED", "false")
os.environ.setdefault("BOKITO_MOCK_EXECUTION", "true")
# Post-commit gateway safety-net tasks hit the wrong SQLite DB in tests.
os.environ.setdefault("BOKITO_ENTITY_PUBLISH_SAFETY_NET", "0")

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


@pytest.fixture(autouse=True)
def _fast_redis_enqueue(monkeypatch: pytest.MonkeyPatch):
    """Do not connect to localhost Redis or spawn inline ARQ fallbacks in tests."""
    from unittest.mock import AsyncMock

    import app.workers.tasks as tasks

    tasks._arq_pool = None
    tasks._arq_pool_unavailable = True
    monkeypatch.setattr(tasks, "enqueue_signal_processing", AsyncMock())
    monkeypatch.setattr(tasks, "enqueue_repo_index", AsyncMock())
    monkeypatch.setattr(tasks, "enqueue_webhook_delivery", AsyncMock())
    if hasattr(tasks, "enqueue_module_source_index"):
        monkeypatch.setattr(tasks, "enqueue_module_source_index", AsyncMock())
    yield
    tasks._arq_pool = None
    tasks._arq_pool_unavailable = False


@pytest.fixture(autouse=True)
def _reset_model_routing():
    from app.services import bokito_models, provider_health

    bokito_models.reset_route_cache()
    provider_health.reset()
    yield
    bokito_models.reset_route_cache()
    provider_health.reset()


@pytest.fixture
def unparked_channels(monkeypatch: pytest.MonkeyPatch):
    """Bring every channel back on the product surface for one test.

    Slack ships parked (PARKED_CHANNELS defaults to "slack"), so adapter and
    webhook tests that need to connect a Slack workspace ask for this fixture.
    """
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "parked_channels", "")
    yield


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
    session_override.add(
        Agent(
            tenant_id=tenant.id,
            name="Test Assistant",
            role="assistant",
            slug="assistant",
            chat_access="everyone",
            runtime_status="standby",
            system_prompt="Test assistant",
            is_lead=True,
        )
    )
    session_override.add(
        Agent(
            tenant_id=tenant.id,
            name="Test Orchestra",
            role="orchestra",
            slug="orchestra",
            chat_access="nobody",
            runtime_status="standby",
            system_prompt="Test orchestra agent",
        )
    )
    # Sendable Gmail stand-in (mock credentials). Provider must be a real
    # mailbox slug so the email settings API lists it; `mock` provider is hidden.
    session_override.add(
        ChannelAccount(
            tenant_id=tenant.id,
            channel="email",
            address="support@test.local",
            provider="gmail",
            credentials_json='{"access_token": "mock-access-token", "mock": true}',
        )
    )
    # Website chat is opt-in in product; tests that hit livechat still need a
    # row. Address uses the operator shape so startup cleanup of unused seeded
    # widgets (address == slug) does not disable it.
    session_override.add(
        ChannelAccount(
            tenant_id=tenant.id,
            channel="widget",
            provider="widget",
            address=f"{tenant.slug}:{uuid4().hex[:10]}",
            display_name="Website chat",
            is_enabled=True,
            settings_json=json.dumps(
                {
                    # No channel AI-handling override: tests that set the
                    # workspace default (assisted/manual) must keep winning.
                    "livechat_settings": {"pre_chat_form": True},
                    "widget_settings_migrated": True,
                }
            ),
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
