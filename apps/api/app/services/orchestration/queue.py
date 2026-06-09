"""ARQ enqueue helpers for orchestration segments."""

from __future__ import annotations

import os

from arq import create_pool
from arq.connections import RedisSettings

from app.config import get_settings

settings = get_settings()


async def enqueue_agent_task_segment(tenant_id: str, task_id: str) -> bool:
    if os.environ.get("BOKITO_MOCK_EXECUTION", "").lower() in ("1", "true", "yes"):
        return False
    try:
        redis = await create_pool(RedisSettings.from_dsn(settings.redis_url))
        await redis.enqueue_job("run_agent_task_segment", tenant_id, task_id)
        return True
    except Exception:
        return False


async def enqueue_workstream_run(tenant_id: str, workstream_id: str, trigger_type: str = "manual") -> bool:
    if os.environ.get("BOKITO_MOCK_EXECUTION", "").lower() in ("1", "true", "yes"):
        return False
    try:
        redis = await create_pool(RedisSettings.from_dsn(settings.redis_url))
        await redis.enqueue_job("run_workstream_orchestrated", tenant_id, workstream_id, trigger_type)
        return True
    except Exception:
        return False
