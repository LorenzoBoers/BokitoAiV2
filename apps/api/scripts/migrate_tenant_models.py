"""Migrate legacy tenant_secrets + platform catalog prefs to tenant provider models."""

from __future__ import annotations

import asyncio

from sqlalchemy import select

from app.db.session import async_session_factory, init_db
from app.models.auth import Tenant
from app.models.secret import TenantSecret
from app.services import model_catalog, provider_connections, tenant_model_catalog, tenant_secrets
from app.services.tenant_models import get_tenant_model_prefs


async def migrate_tenant(session, tenant: Tenant) -> None:
    if await tenant_model_catalog.tenant_has_models(session, tenant.id):
        return

    secrets = await session.execute(
        select(TenantSecret).where(TenantSecret.tenant_id == tenant.id)
    )
    secret_rows = list(secrets.scalars().all())
    if not secret_rows:
        return

    prefs = await get_tenant_model_prefs(session, tenant.id)
    allowed = prefs.get("allowed_chat") or []
    default_chat = prefs.get("default_chat") or ""
    default_embedding = prefs.get("default_embedding") or ""

    platform_models = await model_catalog.list_models(session, enabled_only=True)
    conn_by_type: dict[str, object] = {}

    for secret in secret_rows:
        if secret.provider not in ("anthropic", "openai"):
            continue
        raw = await tenant_secrets.get_secret(session, tenant.id, secret.provider)
        if not raw:
            continue
        provider_type = secret.provider
        conn = await provider_connections.create_connection(
            session,
            tenant.id,
            provider_type=provider_type,
            api_key=raw,
        )
        conn_by_type[provider_type] = conn

    for pm in platform_models:
        conn = conn_by_type.get(pm.provider)
        if not conn:
            continue
        if pm.kind == "chat" and allowed and pm.slug not in allowed:
            enabled = False
        else:
            enabled = pm.enabled
        is_def_chat = pm.slug == default_chat or pm.is_default_chat
        is_def_emb = pm.slug == default_embedding or pm.is_default_embedding
        try:
            await tenant_model_catalog.create_model(
                session,
                tenant.id,
                connection_id=conn.id,
                slug=pm.slug,
                model_id=pm.model_id,
                display_name=pm.display_name,
                kind=pm.kind,
                enabled=enabled,
                supports_tools=pm.supports_tools,
                supports_vision=pm.supports_vision,
                context_window=pm.context_window,
                input_cost_per_mtok_cents=pm.input_cost_per_mtok_cents,
                output_cost_per_mtok_cents=pm.output_cost_per_mtok_cents,
                is_default_chat=is_def_chat and pm.kind == "chat",
                is_default_embedding=is_def_emb and pm.kind == "embedding",
                sort_order=pm.sort_order,
            )
        except ValueError:
            continue

    print(f"Migrated tenant {tenant.slug} ({tenant.id})")


async def main() -> None:
    await init_db()
    async with async_session_factory() as session:
        result = await session.execute(select(Tenant))
        tenants = list(result.scalars().all())
        for tenant in tenants:
            await migrate_tenant(session, tenant)
    print("Migration complete.")


if __name__ == "__main__":
    asyncio.run(main())
