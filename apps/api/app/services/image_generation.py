"""Bokito image layer.

This is not the chat Bokito model. Chat stays on ``resolve_model_call`` with
``kind="chat"`` and ``provider="bokito"`` virtual rows in the model catalog.
Image calls use ``kind="image"``, slug ``bokito-image``, and this module only.

The default backbone is DALL-E 2 on the OpenAI spec. Mistral is the second
image provider: its adapter calls Chat Completions with the
``image_generation`` tool, not the OpenAI Images API. ``bokito-image`` walks
that chain and keeps the first backing that has a tenant or platform key.
Both are ``ProviderSpec`` rows with capability ``image`` and show up as
``TenantModel`` nodes (``origin=platform``) on the same tables a workspace
uses for its own providers.

After generation, ``generate_image`` writes ``usage_ledger`` via
``record_usage`` / ``record_platform_unit_usage`` (images or tokens).
"""

from __future__ import annotations

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.image_providers import (
    ImageGenerationResult,
    get_image_provider,
)
from app.services.model_regions import infer_provider, provider_region
from app.services.model_resolution import _resolve_platform_key
from app.services.provider_spec import get_provider_spec

BOKITO_IMAGE_SLUG = "bokito-image"
BOKITO_IMAGE_PROVIDER = "bokito"
# Cheapest OpenAI Images model on the key Bokito already has. 1024x1024 list
# price is 2 cents; not charged until image billing is switched on.
DEFAULT_IMAGE_BACKINGS: tuple[str, ...] = ("dall-e-2", "mistral-image")
DALL_E_2_LIST_PRICE_CENTS = 2


@dataclass(frozen=True)
class ImageModelSpec:
    slug: str
    provider_type: str
    model_id: str
    list_price_cents: int | None = None


IMAGE_MODELS: dict[str, ImageModelSpec] = {
    "dall-e-2": ImageModelSpec(
        slug="dall-e-2",
        provider_type="openai",
        model_id="dall-e-2",
        list_price_cents=DALL_E_2_LIST_PRICE_CENTS,
    ),
    # Chat model that hosts Mistral's image_generation tool. List price is the
    # last published tool price ($0.10); the model pricing page no longer shows it.
    "mistral-image": ImageModelSpec(
        slug="mistral-image",
        provider_type="mistral",
        model_id="mistral-small-latest",
        list_price_cents=10,
    ),
}


@dataclass
class ResolvedImageCall:
    slug: str
    provider: str  # bokito when the virtual layer was asked for
    provider_type: str
    model_id: str
    kind: str
    api_key: str
    key_source: str  # tenant | platform | mock
    base_url: str = ""
    region: str = "unknown"
    list_price_cents: int | None = None

    @property
    def live(self) -> bool:
        return self.key_source != "mock" and bool(self.api_key)

    @property
    def billable(self) -> bool:
        return self.key_source == "platform"


@dataclass
class ImageUsageEvent:
    """Metering payload mirrored into ``usage_ledger`` after generation."""

    call_type: str
    provider: str
    model: str
    provider_type: str
    model_id: str
    key_source: str
    region: str
    billable: bool
    unit: str  # image | token
    images: int
    tokens_in: int
    tokens_out: int
    provider_list_price_cents: int | None
    customer_cost_micros: int = 0
    priced: bool = True


@dataclass
class ImageGeneration:
    resolved: ResolvedImageCall
    result: ImageGenerationResult
    usage: ImageUsageEvent

    @property
    def mock(self) -> bool:
        return self.result.mock


def _candidate(slug: str) -> ImageModelSpec | None:
    known = IMAGE_MODELS.get(slug)
    if known is not None:
        return known
    provider_type = infer_provider(slug)
    spec = get_provider_spec(provider_type)
    if spec is None or "image" not in spec.capabilities:
        return None
    return ImageModelSpec(slug=slug, provider_type=spec.type, model_id=slug)


async def resolve_image_call(
    session: AsyncSession,
    tenant_id: UUID,
    *,
    model_slug: str | None = None,
) -> ResolvedImageCall:
    """Resolve an image call without entering the chat model resolver."""
    requested = (model_slug or "").strip() or BOKITO_IMAGE_SLUG
    # Unknown slugs stay on the virtual layer instead of inventing a provider.
    virtual = requested == BOKITO_IMAGE_SLUG or _candidate(requested) is None
    slugs = DEFAULT_IMAGE_BACKINGS if virtual else (requested,)
    first: ImageModelSpec | None = None
    first_key = ""
    first_source = "mock"
    first_base = ""
    chosen: ImageModelSpec | None = None
    api_key = ""
    key_source = "mock"
    base_url = ""
    for slug in slugs:
        candidate = _candidate(slug)
        if candidate is None:
            continue
        api_key, key_source, base_url = await _image_credentials(
            session, tenant_id, candidate
        )
        if first is None:
            first = candidate
            first_key, first_source, first_base = api_key, key_source, base_url
        if api_key and key_source in ("tenant", "platform"):
            chosen = candidate
            break
        chosen = None
    if chosen is None:
        chosen = first or IMAGE_MODELS[DEFAULT_IMAGE_BACKINGS[0]]
        api_key, key_source, base_url = first_key, first_source, first_base
    return ResolvedImageCall(
        slug=BOKITO_IMAGE_SLUG if virtual else chosen.slug,
        provider=BOKITO_IMAGE_PROVIDER if virtual else chosen.provider_type,
        provider_type=chosen.provider_type,
        model_id=chosen.model_id,
        kind="image",
        api_key=api_key,
        key_source=key_source if api_key else "mock",
        base_url=base_url,
        region=provider_region(chosen.provider_type, base_url),
        list_price_cents=chosen.list_price_cents,
    )


async def _image_credentials(
    session: AsyncSession | None,
    tenant_id: UUID,
    candidate: ImageModelSpec,
) -> tuple[str, str, str]:
    """Tenant connection key when that row has one, otherwise the platform key."""
    base_url = ""
    if session is not None:
        from sqlalchemy import select

        from app.models.provider import ProviderConnection, TenantModel
        from app.services.provider_connections import get_decrypted_key

        row = (
            await session.execute(
                select(TenantModel).where(
                    TenantModel.tenant_id == tenant_id,
                    TenantModel.slug == candidate.slug,
                    TenantModel.enabled.is_(True),
                )
            )
        ).scalar_one_or_none()
        if row is not None:
            conn = (
                await session.execute(
                    select(ProviderConnection).where(ProviderConnection.id == row.connection_id)
                )
            ).scalar_one_or_none()
            if conn is not None and conn.enabled:
                base_url = conn.base_url or ""
                key = await get_decrypted_key(session, conn)
                if key:
                    return key, "tenant", base_url
    if session is None:
        api_key, key_source = await _resolve_platform_key(
            session, tenant_id, candidate.provider_type
        )
        return api_key, key_source, base_url
    api_key, key_source = await _resolve_platform_key(
        session, tenant_id, candidate.provider_type
    )
    return api_key, key_source, base_url


def image_generation_disabled(prefs: dict | None) -> bool:
    """Tenant opt-out. Empty means the Bokito image tool stays on."""
    raw = str((prefs or {}).get("image_generation") or "").strip().lower()
    return raw in {"off", "disabled", "none"}


async def resolve_image_model_slug(
    session: AsyncSession | None,
    tenant_id: UUID,
    *,
    agent_slug: str | None = None,
) -> str:
    """Pick the image slug the way chat picks a model slug.

    Order: explicit agent slug, then the workspace ``image_model`` pref, then
    the catalog default ``bokito-image`` (DALL-E 2, then Mistral when that key
    is the one that is live).
    """
    explicit = (agent_slug or "").strip().lower()
    if explicit and explicit not in {"inherit", "automatic", "bokito", "default"}:
        return explicit
    if session is not None:
        from app.services.tenant_models import get_tenant_model_prefs

        prefs = await get_tenant_model_prefs(session, tenant_id)
        if image_generation_disabled(prefs):
            return ""
        chosen = str(prefs.get("image_model") or "").strip()
        if chosen and not image_generation_disabled({"image_generation": chosen}):
            return chosen
    return BOKITO_IMAGE_SLUG


def image_usage_event(
    resolved: ResolvedImageCall, result: ImageGenerationResult
) -> ImageUsageEvent:
    """Describe the call for a later ledger write. Does not price or persist it."""
    tokens = result.tokens_in + result.tokens_out
    return ImageUsageEvent(
        call_type="image",
        provider=resolved.provider,
        model=resolved.slug,
        provider_type=resolved.provider_type,
        model_id=result.model_id or resolved.model_id,
        key_source=resolved.key_source,
        region=resolved.region,
        billable=resolved.billable and not result.mock,
        unit="token" if tokens else "image",
        images=result.images_count,
        tokens_in=result.tokens_in,
        tokens_out=result.tokens_out,
        provider_list_price_cents=resolved.list_price_cents,
    )


async def generate_image(
    session: AsyncSession,
    tenant_id: UUID,
    prompt: str,
    *,
    model_slug: str | None = None,
    size: str = "1024x1024",
    n: int = 1,
) -> ImageGeneration:
    """Resolve the Bokito image layer and call the backing adapter."""
    text = (prompt or "").strip()
    if not text:
        raise ValueError("Prompt cannot be empty")
    if n < 1:
        raise ValueError("n must be at least 1")
    slug = model_slug
    if not (slug or "").strip() and session is not None:
        from app.services.tenant_models import get_tenant_model_prefs

        prefs = await get_tenant_model_prefs(session, tenant_id)
        slug = (prefs.get("image_model") or "").strip() or None
    resolved = await resolve_image_call(session, tenant_id, model_slug=slug)
    provider = get_image_provider(
        resolved.provider_type, resolved.api_key, resolved.base_url or None
    )
    result = await provider.generate(text, model_id=resolved.model_id, size=size, n=n)
    usage = image_usage_event(resolved, result)
    if session is not None and not result.mock:
        await _persist_image_usage(session, tenant_id, resolved, usage)
    return ImageGeneration(
        resolved=resolved,
        result=result,
        usage=usage,
    )


async def _persist_image_usage(
    session: AsyncSession,
    tenant_id: UUID,
    resolved: ResolvedImageCall,
    usage: ImageUsageEvent,
) -> None:
    from app.services.model_resolution import (
        ResolvedModelCall,
        record_platform_unit_usage,
        record_usage,
    )

    if usage.tokens_in or usage.tokens_out:
        fake = ResolvedModelCall(
            slug=resolved.slug,
            provider=resolved.provider,
            provider_type=resolved.provider_type,
            model_id=resolved.model_id,
            kind="image",
            api_key=resolved.api_key,
            key_source=resolved.key_source,
            region=resolved.region,
            input_cost_per_mtok_cents=0,
            output_cost_per_mtok_cents=0,
            markup=1.0,
        )
        await record_usage(
            session,
            tenant_id,
            fake,
            tokens_in=usage.tokens_in,
            tokens_out=usage.tokens_out,
            call_type="image",
            units=usage.images,
            unit_kind="image",
            commit=False,
        )
        return
    await record_platform_unit_usage(
        session,
        tenant_id,
        call_type="image",
        unit_kind="image",
        units=max(usage.images, 1),
        provider=resolved.provider_type or resolved.provider,
        model=resolved.model_id or resolved.slug,
        region=resolved.region,
        key_source=resolved.key_source,
        commit=False,
    )
