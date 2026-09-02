"""ARQ enqueue helpers for orchestration segments."""

from __future__ import annotations

import logging
import os

from app.config import get_settings
from app.services.runtime_health import record_redis_enqueue_failure

settings = get_settings()
logger = logging.getLogger(__name__)


async def enqueue_agent_task_segment(tenant_id: str, task_id: str) -> bool:
    if os.environ.get("BOKITO_MOCK_EXECUTION", "").lower() in ("1", "true", "yes"):
        return False
    try:
        from app.workers.tasks import _get_arq_pool

        redis = await _get_arq_pool()
        await redis.enqueue_job("run_agent_task_segment_job", tenant_id, task_id)
        return True
    except Exception as exc:  # noqa: BLE001 — caller falls back to inline execution
        logger.warning("Redis unavailable, agent task segment %s runs inline: %s", task_id, exc)
        record_redis_enqueue_failure(f"agent_task_segment: {exc}")
        return False


async def enqueue_workstream_run(tenant_id: str, workstream_id: str, trigger_type: str = "manual") -> bool:
    if os.environ.get("BOKITO_MOCK_EXECUTION", "").lower() in ("1", "true", "yes"):
        return False
    try:
        from app.workers.tasks import _get_arq_pool

        redis = await _get_arq_pool()
        await redis.enqueue_job("run_workstream_orchestrated", tenant_id, workstream_id, trigger_type)
        return True
    except Exception as exc:  # noqa: BLE001 — caller falls back to inline execution
        logger.warning("Redis unavailable, workstream %s runs inline: %s", workstream_id, exc)
        record_redis_enqueue_failure(f"workstream_run: {exc}")
        return False
