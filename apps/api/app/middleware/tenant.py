"""Resolve tenant from Host header (subdomain) for *.bokito.ai style routing."""

from uuid import UUID

from sqlalchemy import select
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from app.db.session import async_session_factory
from app.models.auth import Tenant


def extract_slug_from_host(host: str) -> str | None:
    host = host.split(":")[0].lower()
    if host in {"localhost", "127.0.0.1", "test"}:
        return None
    parts = host.split(".")
    if len(parts) >= 3 and parts[-2] == "bokito" and parts[-1] == "ai":
        return parts[0]
    return None


class TenantHostMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        slug = extract_slug_from_host(request.headers.get("host", ""))
        request.state.tenant_slug = slug
        request.state.resolved_tenant_id: UUID | None = None
        if slug:
            async with async_session_factory() as session:
                result = await session.execute(select(Tenant).where(Tenant.slug == slug))
                tenant = result.scalar_one_or_none()
                if tenant:
                    request.state.resolved_tenant_id = tenant.id
        return await call_next(request)
