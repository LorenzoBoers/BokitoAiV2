"""In-process trigger scheduler: fires due cron/interval/heartbeat triggers.

This loop is the canonical scheduler for triggers and the hourly learning
cycle. Email mailbox polling lives on the ARQ worker
(`sync_email_mailboxes_job` cron) so the API process does not double-poll
the same mailboxes.
"""

import asyncio
import logging
import os
import time

from app.db.session import async_session_factory
from app.services.runtime_health import record_scheduler_tick
from app.services.triggers import process_due_triggers

logger = logging.getLogger(__name__)

_TICK_SECONDS = 60
_LEARNING_INTERVAL_SECONDS = 3600


def trigger_scheduler_enabled() -> bool:
    return os.environ.get("TRIGGER_SCHEDULER_ENABLED", "true").lower() not in (
        "0",
        "false",
        "no",
        "off",
    )


async def trigger_scheduler_loop() -> None:
    last_learning_run = 0.0
    while True:
        error: str | None = None
        try:
            async with async_session_factory() as session:
                count = await process_due_triggers(session)
                if count:
                    logger.info("Trigger scheduler fired %s trigger(s)", count)

                from app.services.orchestration.dispatcher import (
                    process_due_scheduled_tasks,
                )

                due_tasks = await process_due_scheduled_tasks(session)
                if due_tasks:
                    logger.info("Woke %s scheduled task(s)", due_tasks)

                from app.services.signal_threads import (
                    deliver_due_outbound_messages,
                    wake_snoozed_threads,
                )

                woken = await wake_snoozed_threads(session)
                if woken:
                    logger.info("Woke %s snoozed thread(s)", woken)

                sent = await deliver_due_outbound_messages(session)
                if sent:
                    logger.info("Delivered %s scheduled message(s)", sent)

                if time.monotonic() - last_learning_run >= _LEARNING_INTERVAL_SECONDS:
                    last_learning_run = time.monotonic()
                    from app.services.learning import run_learning_for_enabled_tenants

                    results = await run_learning_for_enabled_tenants(session)
                    if results:
                        logger.info("Learning cycle ran for %s tenant(s)", len(results))

                    from app.services.onboarding_demo import send_channel_nudges

                    nudged = await send_channel_nudges(session)
                    if nudged:
                        logger.info("Sent %s onboarding channel nudge(s)", nudged)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            error = f"{type(exc).__name__}: {exc}"
            logger.exception("Trigger scheduler tick failed")

        record_scheduler_tick(error)
        await asyncio.sleep(_TICK_SECONDS)
