"""Resolve a model call to provider + model_id + API key + key source + pricing.

Resolution order for the API key (per provider):
  1. Tenant BYOK secret  -> key_source="tenant", not billable
  2. Platform secret      -> key_source="platform", billable (token resale)
  3. Env fallback (live)  -> key_source="platform", billable (bootstrap key)
  4. None                 -> key_source="mock" (deterministic mock provider)

Catalog rows drive pricing and the real provider ``model_id``. If the catalog
is empty (e.g. fresh DB / unit tests) we degrade to safe built-in defaults.
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.usage import UsageLedger
from app.services import model_catalog as catalog_svc
from app.services import platform_secrets, tenant_secrets

settings = get_settings()

# Used only when the catalog has no matching row (keeps the app functional).
_FALLBACK_CHAT = ("claude-sonnet-4", "anthropic", "claude-sonnet-4-20250514")
_FALLBACK_EMBEDDING = ("text-embedding-3-small", "openai", "text-embedding-3-small")


@dataclass
class ResolvedModelCall:
    slug: str
    provider: str  # anthropic | openai
    model_id: str
    kind: str  # chat | embedding
    api_key: str
    key_source: str  # tenant | platform | mock
    input_cost_per_mtok_cents: int = 0
    output_cost_per_mtok_cents: int = 0
    markup: float = catalog_svc.DEFAULT_MARKUP

    @property
    def live(self) -> bool:
        return self.key_source != "mock" and bool(self.api_key)

    @property
    def billable(self) -> bool:
        return self.key_source == "platform"


def _env_key(provider: str) -> str:
    if settings.llm_mode != "live":
        return ""
    if provider == "anthropic":
        return settings.anthropic_api_key or ""
    if provider == "openai":
        return settings.openai_api_key or ""
    return ""


async def _resolve_key(session: AsyncSession, tenant_id: UUID, provider: str) -> tuple[str, str]:
    """Return (api_key, key_source) for a provider following the priority chain."""
    tenant_key = await tenant_secrets.get_secret(session, tenant_id, provider)
    if tenant_key:
        return tenant_key, "tenant"
    platform_key = await platform_secrets.get_platform_secret(session, provider)
    if platform_key:
        return platform_key, "platform"
    env_key = _env_key(provider)
    if env_key:
        return env_key, "platform"
    return "", "mock"


async def resolve_model_call(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    kind: str = "chat",
    model_slug: str | None = None,
) -> ResolvedModelCall:
    markup = await catalog_svc.get_markup_multiplier(session)

    model = None
    if model_slug:
        model = await catalog_svc.get_model(session, model_slug)
        if model and model.kind != kind:
            model = None
    if model is None:
        # Fall back to the tenant's preferred default for this kind, then platform default.
        from app.services.tenant_models import get_tenant_model_prefs

        prefs = await get_tenant_model_prefs(session, tenant_id)
        pref_slug = prefs.get("default_chat") if kind == "chat" else prefs.get("default_embedding")
        if pref_slug:
            model = await catalog_svc.get_model(session, pref_slug)
            if model and model.kind != kind:
                model = None
    if model is None:
        model = await catalog_svc.get_default_model(session, kind)

    if model is not None:
        provider = model.provider
        slug = model.slug
        model_id = model.model_id or model.slug
        in_cents = model.input_cost_per_mtok_cents
        out_cents = model.output_cost_per_mtok_cents
    else:
        slug, provider, model_id = _FALLBACK_CHAT if kind == "chat" else _FALLBACK_EMBEDDING
        in_cents = out_cents = 0

    api_key, key_source = await _resolve_key(session, tenant_id, provider)

    return ResolvedModelCall(
        slug=slug,
        provider=provider,
        model_id=model_id,
        kind=kind,
        api_key=api_key,
        key_source=key_source,
        input_cost_per_mtok_cents=in_cents,
        output_cost_per_mtok_cents=out_cents,
        markup=markup,
    )


def compute_costs(
    resolved: ResolvedModelCall, tokens_in: int, tokens_out: int
) -> tuple[int, int]:
    """Return (provider_cost_micros, customer_cost_micros) in micro-USD (1e-6 USD)."""
    provider_micros = round(
        tokens_in * resolved.input_cost_per_mtok_cents / 100
        + tokens_out * resolved.output_cost_per_mtok_cents / 100
    )
    customer_micros = round(provider_micros * resolved.markup) if resolved.billable else 0
    return provider_micros, customer_micros


async def record_usage(
    session: AsyncSession,
    tenant_id: UUID,
    resolved: ResolvedModelCall,
    *,
    tokens_in: int,
    tokens_out: int,
    scope: str = "chat",
    scope_id: str | None = None,
    call_type: str = "chat",
    agent_id: UUID | None = None,
    run_id: UUID | None = None,
    user_id: UUID | None = None,
    commit: bool = False,
) -> UsageLedger:
    """Write a metered usage row. Customer cost applies only to platform keys."""
    provider_micros, customer_micros = compute_costs(resolved, tokens_in, tokens_out)
    billable = resolved.billable
    legacy_cents = round((customer_micros if billable else provider_micros) / 10000)

    entry = UsageLedger(
        tenant_id=tenant_id,
        scope=scope,
        scope_id=scope_id,
        call_type=call_type,
        provider=resolved.provider,
        model=resolved.slug,
        key_source=resolved.key_source,
        billable=billable,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        provider_cost_micros=provider_micros,
        customer_cost_micros=customer_micros,
        cost_cents=legacy_cents,
        agent_id=agent_id,
        run_id=run_id,
        user_id=user_id,
    )
    session.add(entry)
    if commit:
        await session.commit()
    return entry
