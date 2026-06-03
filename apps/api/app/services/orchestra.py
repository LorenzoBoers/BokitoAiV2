"""V2 orchestra scheduler skeleton."""

from uuid import UUID



async def schedule_orchestra_for_tenant(tenant_id: UUID) -> None:
    """Enqueue a periodic orchestra scan for the tenant (V2)."""
    from arq import create_pool
    from arq.connections import RedisSettings

    from app.config import get_settings

    settings = get_settings()
    redis = await create_pool(RedisSettings.from_dsn(settings.redis_url))
    await redis.enqueue_job("orchestra_tick", str(tenant_id))
