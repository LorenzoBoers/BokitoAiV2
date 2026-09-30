"""Test fixtures: a real Postgres with pgvector.

Uses `TEST_DATABASE_URL` when set (CI service container); otherwise starts an
embedded Postgres through `pgserver` in a temp directory. There is no SQLite
path: tests run on the same engine as production.
"""

from __future__ import annotations

import os
import tempfile
import uuid
from collections.abc import AsyncIterator, Iterator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text

os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("LLM_MODE", "mock")
os.environ.setdefault("JWT_SECRET", "test-secret-test-secret-test-secret-1234")

from bokito import db as dbmod  # noqa: E402
from bokito.domain import Base  # noqa: E402


def _embedded_postgres_url() -> tuple[str, object]:
    import pgserver
    import psycopg

    data_dir = os.path.join(tempfile.gettempdir(), "bokito_v2_pgtest")
    server = pgserver.get_server(data_dir)
    admin_uri = server.get_uri()
    dbname = "bokito_test_" + uuid.uuid4().hex[:8]
    with psycopg.connect(admin_uri, autocommit=True) as conn:
        conn.execute(f'CREATE DATABASE "{dbname}"')
    host_part = admin_uri.split("@", 1)[1].rsplit("/", 1)[0]
    return f"postgresql+asyncpg://postgres@{host_part}/{dbname}", server


@pytest.fixture(scope="session")
def database_url() -> Iterator[str]:
    url = os.environ.get("TEST_DATABASE_URL")
    server = None
    if not url:
        url, server = _embedded_postgres_url()
    yield url
    if server is not None:
        server.cleanup()


@pytest.fixture(scope="session", autouse=True)
async def _schema(database_url: str) -> AsyncIterator[None]:
    dbmod.configure_database(database_url)
    engine = dbmod.get_engine()
    async with engine.begin() as conn:
        await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield
    await dbmod.dispose_engine()


@pytest.fixture(autouse=True)
async def _clean_tables() -> AsyncIterator[None]:
    yield
    engine = dbmod.get_engine()
    tables = ", ".join(f'"{t.name}"' for t in reversed(Base.metadata.sorted_tables))
    async with engine.begin() as conn:
        await conn.execute(text(f"TRUNCATE {tables} CASCADE"))


@pytest.fixture
async def client() -> AsyncIterator[AsyncClient]:
    from bokito.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
async def session():
    async with dbmod.get_session_factory()() as s:
        yield s


async def signup(
    client: AsyncClient, email: str = "owner@example.com", workspace: str = "Acme"
) -> dict:
    r = await client.post(
        "/api/auth/signup",
        json={
            "email": email,
            "password": "correct horse battery",
            "name": "Owner",
            "workspace_name": workspace,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


def auth(token: dict) -> dict[str, str]:
    return {"Authorization": f"Bearer {token['access_token']}"}


@pytest.fixture
async def owner(client: AsyncClient) -> dict:
    return await signup(client)
