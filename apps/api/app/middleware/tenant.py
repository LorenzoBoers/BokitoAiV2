"""Resolve tenant from Host header (subdomain) for *.bokito.ai style routing."""

import time
from uuid import UUID

from sqlalchemy import select
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.db.session import async_session_factory
from app.models.auth import Tenant

# Slug -> id is near-static; a short TTL avoids a DB session on every request
# under subdomain routing without needing explicit invalidation on rename.
_SLUG_TTL_S = 60.0
_slug_cache: dict[str, tuple[UUID | None, float]] = {}


def extract_slug_from_host(host: str) -> str | None:
    host = host.split(":")[0].lower()
    if host in {"localhost", "127.0.0.1", "test"}:
        return None
    parts = host.split(".")
    if len(parts) >= 3 and parts[-2] == "bokito" and parts[-1] == "ai":
        return parts[0]
    return None


def clear_tenant_slug_cache() -> None:
    """Test helper / staff rename hook."""
    _slug_cache.clear()


async def resolve_tenant_id_for_slug(slug: str) -> UUID | None:
    """Lookup tenant id by slug with a short process-local cache."""
    now = time.monotonic()
    cached = _slug_cache.get(slug)
    if cached is not None and cached[1] > now:
        return cached[0]
    async with async_session_factory() as session:
        result = await session.execute(select(Tenant).where(Tenant.slug == slug))
        tenant = result.scalar_one_or_none()
        tenant_id = tenant.id if tenant else None
    _slug_cache[slug] = (tenant_id, now + _SLUG_TTL_S)
    return tenant_id


class TenantHostMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        slug = extract_slug_from_host(request.headers.get("host", ""))
        request.state.tenant_slug = slug
        request.state.resolved_tenant_id: UUID | None = None
        if slug:
            request.state.resolved_tenant_id = await resolve_tenant_id_for_slug(slug)
        return await call_next(request)
