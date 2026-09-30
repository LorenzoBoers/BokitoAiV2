"""ARQ worker: background jobs and the scheduler.

Run with `arq bokito.workers.WorkerSettings`. Jobs are plain async functions
that open their own session; `queue.enqueue` falls back to running them
inline when Redis is not configured (development without Redis, tests).
"""

from __future__ import annotations

from bokito.workers.jobs import (
    compute_outcomes_job,
    fire_due_triggers_job,
    handle_inbound_job,
    run_agent_job,
    run_playbook_job,
    run_trigger_agent_job,
    send_message_job,
)

FUNCTIONS = [
    run_agent_job,
    run_playbook_job,
    run_trigger_agent_job,
    handle_inbound_job,
    send_message_job,
    compute_outcomes_job,
    fire_due_triggers_job,
]


def _settings_class():
    from arq.connections import RedisSettings
    from arq.cron import cron

    from bokito.config import get_settings

    settings = get_settings()

    class WorkerSettings:
        functions = FUNCTIONS
        redis_settings = RedisSettings.from_dsn(settings.redis_url or "redis://127.0.0.1:6379/0")
        queue_name = f"{settings.redis_prefix}:queue"
        max_jobs = 10
        job_timeout = 300
        cron_jobs = [
            cron(compute_outcomes_job, hour={2}, minute={15}, run_at_startup=False),
            cron(fire_due_triggers_job, minute=set(range(0, 60, 1)), run_at_startup=False),
        ]

    return WorkerSettings


WorkerSettings = _settings_class()
