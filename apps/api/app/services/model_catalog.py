"""Platform model catalog: seed, lookups, defaults, and resale markup.

The catalog is platform-global and staff-managed. Pricing is the provider list
price in integer cents per 1,000,000 tokens. Tenants choose among ``enabled``
rows; agents reference a row by ``slug`` (legacy agents may still store a raw
``model_id``, which we resolve too).
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.model_catalog import ModelCatalog, PlatformSetting

MARKUP_SETTING_KEY = "token_markup_multiplier"
DEFAULT_MARKUP = 1.3

# slug, provider, kind, model_id, display_name, ctx, in_cents/Mtok, out_cents/Mtok,
# tools, vision, default_chat, default_embedding, sort
DEFAULT_MODELS: list[tuple] = [
    # Bokito AI is the platform's own virtual model: it has no model_id of its
    # own; resolution routes it to a real backing model (see bokito_models.py).
    ("bokito-ai-3-1", "bokito", "chat", "", "Bokito AI 3.1",
     200000, 300, 1500, True, True, True, False, 5),
    ("claude-sonnet-4-6", "anthropic", "chat", "claude-sonnet-4-6", "Claude Sonnet 4.6",
     200000, 300, 1500, True, True, False, False, 10),
    ("claude-haiku-4-5", "anthropic", "chat", "claude-haiku-4-5-20251001", "Claude Haiku 4.5",
     200000, 100, 500, True, True, False, False, 20),
    ("claude-opus-4-8", "anthropic", "chat", "claude-opus-4-8", "Claude Opus 4.8",
     200000, 1500, 7500, True, True, False, False, 30),
    ("gpt-4o", "openai", "chat", "gpt-4o", "GPT-4o",
     128000, 250, 1000, True, True, False, False, 40),
    ("gpt-4o-mini", "openai", "chat", "gpt-4o-mini", "GPT-4o mini",
     128000, 15, 60, True, True, False, False, 50),
    ("text-embedding-3-small", "openai", "embedding", "text-embedding-3-small",
     "Embedding 3 Small", 8191, 2, 0, False, False, False, True, 60),
    ("text-embedding-3-large", "openai", "embedding", "text-embedding-3-large",
     "Embedding 3 Large", 8191, 13, 0, False, False, False, False, 70),
]


# Retired Anthropic snapshot IDs -> current API model ids (non-destructive catalog refresh).
CATALOG_MODEL_ID_REFRESH: dict[str, tuple[str, str, str]] = {
    # slug -> (model_id, display_name, new_slug or same slug)
    "claude-sonnet-4": ("claude-sonnet-4-6", "Claude Sonnet 4.6", "claude-sonnet-4-6"),
    "claude-haiku-4": ("claude-haiku-4-5-20251001", "Claude Haiku 4.5", "claude-haiku-4-5"),
    "claude-opus-4": ("claude-opus-4-8", "Claude Opus 4.8", "claude-opus-4-8"),
}


async def refresh_catalog_model_ids(session: AsyncSession) -> None:
    """Update legacy catalog rows to current provider model ids."""
    from datetime import datetime

    changed = False
    for legacy_slug, (model_id, display_name, new_slug) in CATALOG_MODEL_ID_REFRESH.items():
        result = await session.execute(
            select(ModelCatalog).where(ModelCatalog.slug == legacy_slug)
        )
        row = result.scalar_one_or_none()
        if not row:
            continue
        if new_slug != legacy_slug:
            existing_new = await session.execute(
                select(ModelCatalog).where(ModelCatalog.slug == new_slug)
            )
            if existing_new.scalar_one_or_none():
                await session.delete(row)
                changed = True
                continue
        row.model_id = model_id
        row.display_name = display_name
        row.slug = new_slug
        row.updated_at = datetime.utcnow()
        changed = True
    if changed:
        await session.commit()


BOKITO_MODEL_SLUG = "bokito-ai-3-1"


async def _promote_bokito_default_chat(session: AsyncSession) -> None:
    """Existing databases seeded before the Bokito model default to it now.

    Seeding is non-destructive, so flipping ``is_default_chat`` in
    ``DEFAULT_MODELS`` alone would leave old rows (e.g. Claude Sonnet) as the
    default. Tenants run on the Bokito virtual model unless staff changes it.
    """
    result = await session.execute(
        select(ModelCatalog).where(ModelCatalog.slug == BOKITO_MODEL_SLUG)
    )
    bokito = result.scalar_one_or_none()
    if not bokito:
        return
    changed = False
    if not bokito.is_default_chat:
        bokito.is_default_chat = True
        changed = True
    others = await session.execute(
        select(ModelCatalog).where(
            ModelCatalog.kind == "chat",
            ModelCatalog.is_default_chat.is_(True),
            ModelCatalog.slug != BOKITO_MODEL_SLUG,
        )
    )
    for row in others.scalars().all():
        row.is_default_chat = False
        changed = True
    if changed:
        await session.commit()


# Legacy agent/profile model values -> current slugs. Retired snapshot ids were
# never a deliberate tenant choice, so they move to the Bokito virtual model
# (platform default); explicit current slugs (e.g. claude-sonnet-4-6) stay.
LEGACY_AGENT_MODEL_REFRESH: dict[str, str] = {
    "claude-sonnet-4-20250514": BOKITO_MODEL_SLUG,
    "claude-sonnet-4": BOKITO_MODEL_SLUG,
    "claude-haiku-4-20250514": "claude-haiku-4-5",
    "claude-haiku-4": "claude-haiku-4-5",
}


async def _refresh_legacy_agent_models(session: AsyncSession) -> None:
    """Move agents and runtime profiles off retired model ids at startup."""
    from sqlalchemy import update

    from app.models.agent import Agent
    from app.models.orchestration import RuntimeProfile

    changed = False
    for legacy, current in LEGACY_AGENT_MODEL_REFRESH.items():
        for table in (Agent, RuntimeProfile):
            result = await session.execute(
                update(table).where(table.model == legacy).values(model=current)
            )
            if result.rowcount:
                changed = True
    if changed:
        await session.commit()


async def seed_model_catalog(session: AsyncSession) -> None:
    """Insert any default catalog rows that don't yet exist (non-destructive)."""
    existing = await session.execute(select(ModelCatalog.slug))
    have = {row[0] for row in existing.all()}
    added = False
    for spec in DEFAULT_MODELS:
        (slug, provider, kind, model_id, display_name, ctx, cin, cout,
         tools, vision, def_chat, def_emb, sort) = spec
        if slug in have:
            continue
        session.add(
            ModelCatalog(
                slug=slug,
                provider=provider,
                kind=kind,
                model_id=model_id,
                display_name=display_name,
                context_window=ctx,
                input_cost_per_mtok_cents=cin,
                output_cost_per_mtok_cents=cout,
                supports_tools=tools,
                supports_vision=vision,
                enabled=True,
                is_default_chat=def_chat,
                is_default_embedding=def_emb,
                sort_order=sort,
            )
        )
        added = True
    if added:
        await session.commit()
    await refresh_catalog_model_ids(session)
    await _promote_bokito_default_chat(session)
    await _refresh_legacy_agent_models(session)


async def list_models(
    session: AsyncSession, *, kind: str | None = None, enabled_only: bool = False
) -> list[ModelCatalog]:
    stmt = select(ModelCatalog)
    if kind:
        stmt = stmt.where(ModelCatalog.kind == kind)
    if enabled_only:
        stmt = stmt.where(ModelCatalog.enabled.is_(True))
    stmt = stmt.order_by(ModelCatalog.sort_order, ModelCatalog.display_name)
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def get_model(session: AsyncSession, slug_or_model_id: str) -> ModelCatalog | None:
    """Resolve a catalog row by slug first, then by raw provider model_id."""
    if not slug_or_model_id:
        return None
    result = await session.execute(
        select(ModelCatalog).where(ModelCatalog.slug == slug_or_model_id)
    )
    row = result.scalar_one_or_none()
    if row:
        return row
    result = await session.execute(
        select(ModelCatalog).where(ModelCatalog.model_id == slug_or_model_id)
    )
    return result.scalar_one_or_none()


async def get_default_model(session: AsyncSession, kind: str) -> ModelCatalog | None:
    flag = ModelCatalog.is_default_chat if kind == "chat" else ModelCatalog.is_default_embedding
    result = await session.execute(
        select(ModelCatalog).where(
            ModelCatalog.kind == kind, flag.is_(True), ModelCatalog.enabled.is_(True)
        )
    )
    row = result.scalars().first()
    if row:
        return row
    # Fall back to the first enabled model of the kind.
    models = await list_models(session, kind=kind, enabled_only=True)
    return models[0] if models else None


async def get_markup_multiplier(session: AsyncSession) -> float:
    result = await session.execute(
        select(PlatformSetting).where(PlatformSetting.key == MARKUP_SETTING_KEY)
    )
    row = result.scalar_one_or_none()
    if not row or not row.value:
        return DEFAULT_MARKUP
    try:
        return float(row.value)
    except ValueError:
        return DEFAULT_MARKUP


async def set_markup_multiplier(session: AsyncSession, value: float) -> float:
    from datetime import datetime

    value = max(1.0, float(value))
    result = await session.execute(
        select(PlatformSetting).where(PlatformSetting.key == MARKUP_SETTING_KEY)
    )
    row = result.scalar_one_or_none()
    if row:
        row.value = str(value)
        row.updated_at = datetime.utcnow()
    else:
        session.add(PlatformSetting(key=MARKUP_SETTING_KEY, value=str(value)))
    await session.commit()
    return value


def serialize_model(model: ModelCatalog, *, staff: bool = False) -> dict[str, Any]:
    data = {
        "slug": model.slug,
        "provider": model.provider,
        "kind": model.kind,
        "model_id": model.model_id,
        "display_name": model.display_name,
        "context_window": model.context_window,
        "input_cost_per_mtok_cents": model.input_cost_per_mtok_cents,
        "output_cost_per_mtok_cents": model.output_cost_per_mtok_cents,
        "supports_tools": model.supports_tools,
        "supports_vision": model.supports_vision,
        "enabled": model.enabled,
        "is_default_chat": model.is_default_chat,
        "is_default_embedding": model.is_default_embedding,
    }
    if staff:
        data["id"] = str(model.id)
        data["sort_order"] = model.sort_order
    return data
