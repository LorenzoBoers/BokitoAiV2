import logging
from fastapi import APIRouter, Response, status
from sqlalchemy import text

from app.config import get_settings
from app.db.session import engine


logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])
settings = get_settings()


@router.get("/health")
async def health():
    """Shallow liveness probe (no external dependencies)."""
    return {"ok": True, "service": "bokito-api"}


@router.get("/health/ready")
async def health_ready(response: Response):
    """Deep readiness probe: verifies Postgres and Redis connectivity."""
    checks: dict[str, str] = {}
    ok = True

    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        checks["postgres"] = "ok"
    except Exception as exc:  # noqa: BLE001 — report, don't crash the probe
        logger.warning('health postgres check failed', exc_info=True)
        ok = False
        checks["postgres"] = f"error: {type(exc).__name__}"

    try:
        from redis.asyncio import Redis

        client = Redis.from_url(settings.redis_url, socket_connect_timeout=2)
        try:
            await client.ping()
            checks["redis"] = "ok"
        finally:
            await client.aclose()
    except Exception as exc:  # noqa: BLE001
        logger.warning('health redis check failed', exc_info=True)
        ok = False
        checks["redis"] = f"error: {type(exc).__name__}"

    if not ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    from app.services.runtime_health import runtime_health_snapshot

    return {"ok": ok, "checks": checks, "runtime": runtime_health_snapshot()}
