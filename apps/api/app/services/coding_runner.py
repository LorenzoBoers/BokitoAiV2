"""V2 coding agent sandbox runner skeleton."""

from uuid import UUID



async def enqueue_coding_task(tenant_id: UUID, subject: str, repo_path: str = "/work") -> None:
    from arq import create_pool
    from arq.connections import RedisSettings

    from app.config import get_settings

    settings = get_settings()
    redis = await create_pool(RedisSettings.from_dsn(settings.redis_url))
    await redis.enqueue_job("coding_agent_run", str(tenant_id), subject, repo_path)
