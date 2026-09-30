"""Enqueue helper with inline fallback.

Without Redis (development without a broker, tests) jobs are collected and run
after the request's session has committed (`run_pending`, called by the
session dependency), so a job never observes uncommitted state.
"""

from __future__ import annotations

import logging
from typing import Any

from bokito.config import get_settings

log = logging.getLogger(__name__)

_pool: Any | None = None
_pending: list[tuple[str, tuple[Any, ...], dict[str, Any]]] = []


async def _get_pool():
    global _pool
    settings = get_settings()
    if not settings.redis_url or settings.environment == "test":
        return None
    if _pool is None:
        from arq import create_pool
        from arq.connections import RedisSettings

        _pool = await create_pool(
            RedisSettings.from_dsn(settings.redis_url),
            default_queue_name=f"{settings.redis_prefix}:queue",
        )
    return _pool


async def enqueue(
    job_name: str, *args: Any, defer_seconds: int | None = None, **kwargs: Any
) -> str | None:
    """Queue a job by name. Without Redis the job is deferred until `run_pending`."""
    pool = await _get_pool()
    if pool is None:
        _pending.append((job_name, args, kwargs))
        return None
    job = await pool.enqueue_job(job_name, *args, _defer_by=defer_seconds, **kwargs)
    return job.job_id if job else None


async def run_pending() -> int:
    """Run inline-deferred jobs (no-op when a broker is configured)."""
    from bokito.workers import jobs

    ran = 0
    while _pending:
        job_name, args, kwargs = _pending.pop(0)
        fn = getattr(jobs, job_name)
        try:
            await fn({}, *args, **kwargs)
        except Exception:
            log.exception("inline job %s failed", job_name)
        ran += 1
    return ran


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.aclose()
        _pool = None
