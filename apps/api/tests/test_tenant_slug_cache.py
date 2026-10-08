"""Tenant Host middleware slug→id cache."""

import pytest

from app.middleware.tenant import (
    clear_tenant_slug_cache,
    extract_slug_from_host,
    resolve_tenant_id_for_slug,
)
from app.models.auth import Tenant


def test_extract_slug_from_host():
    assert extract_slug_from_host("acme.bokito.ai") == "acme"
    assert extract_slug_from_host("acme.bokito.ai:443") == "acme"
    assert extract_slug_from_host("localhost") is None
    assert extract_slug_from_host("bokito.ai") is None


@pytest.mark.asyncio
async def test_resolve_tenant_id_for_slug_caches(session_override, monkeypatch):
    clear_tenant_slug_cache()
    tenant = Tenant(slug="slug-cache", name="Slug Cache")
    session_override.add(tenant)
    await session_override.commit()
    await session_override.refresh(tenant)

    # Middleware opens its own session; point the factory at the test session.
    from app.middleware import tenant as tenant_mw

    class _Ctx:
        async def __aenter__(self):
            return session_override

        async def __aexit__(self, *args):
            return False

    calls = {"n": 0}

    def fake_factory():
        calls["n"] += 1
        return _Ctx()

    monkeypatch.setattr(tenant_mw, "async_session_factory", fake_factory)

    first = await resolve_tenant_id_for_slug("slug-cache")
    second = await resolve_tenant_id_for_slug("slug-cache")
    assert first == tenant.id == second
    assert calls["n"] == 1

    missing = await resolve_tenant_id_for_slug("does-not-exist")
    assert missing is None
    again = await resolve_tenant_id_for_slug("does-not-exist")
    assert again is None
    assert calls["n"] == 2
    clear_tenant_slug_cache()
