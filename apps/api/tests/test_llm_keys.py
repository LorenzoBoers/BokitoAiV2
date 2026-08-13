import pytest

from app.models.auth import Tenant
from app.services import platform_secrets, tenant_secrets
from app.services.tenant_llm import resolve_tenant_llm_config


@pytest.mark.asyncio
async def test_tenant_llm_config_isolation(session_override):
    tenant = Tenant(slug="iso-a", name="Tenant A")
    other = Tenant(slug="iso-b", name="Tenant B")
    session_override.add(tenant)
    session_override.add(other)
    await session_override.commit()
    await session_override.refresh(tenant)
    await session_override.refresh(other)

    # Tenant A gets its own keys.
    await tenant_secrets.set_secret(session_override, tenant.id, "anthropic", "sk-ant-aaaa1111")
    await tenant_secrets.set_secret(session_override, tenant.id, "openai", "sk-openai-bbbb2222")

    cfg_a = await resolve_tenant_llm_config(session_override, tenant.id)
    assert cfg_a.live is True
    assert cfg_a.embeddings_live is True
    assert cfg_a.anthropic_api_key == "sk-ant-aaaa1111"

    # Tenant B never sees A's keys and stays mock.
    cfg_b = await resolve_tenant_llm_config(session_override, other.id)
    assert cfg_b.live is False
    assert cfg_b.embeddings_live is False
    assert cfg_b.anthropic_api_key == ""

    # Platform (Bokito) key makes every tenant live without BYOK.
    await platform_secrets.set_platform_secret(session_override, "anthropic", "sk-ant-platform-shared")
    cfg_platform = await resolve_tenant_llm_config(session_override, other.id)
    assert cfg_platform.live is True
    assert cfg_platform.anthropic_api_key == "sk-ant-platform-shared"

    # Round-trip decryption works and is scoped per tenant.
    assert await tenant_secrets.get_secret(session_override, tenant.id, "anthropic") == "sk-ant-aaaa1111"
    assert await tenant_secrets.get_secret(session_override, other.id, "anthropic") is None


@pytest.mark.asyncio
async def test_set_secret_rejects_empty(session_override):
    tenant = Tenant(slug="empty-key", name="Empty Key Tenant")
    session_override.add(tenant)
    await session_override.commit()
    await session_override.refresh(tenant)
    with pytest.raises(ValueError):
        await tenant_secrets.set_secret(session_override, tenant.id, "anthropic", "   ")
