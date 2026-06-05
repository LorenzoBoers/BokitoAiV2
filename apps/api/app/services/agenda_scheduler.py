"""In-process agenda orchestrator wake scheduler."""

import asyncio
import logging
import os

from app.db.session import async_session_factory
from app.services.agenda import process_due_orchestrator_events

logger = logging.getLogger(__name__)

_TICK_SECONDS = 60


def agenda_scheduler_enabled() -> bool:
    return os.environ.get("AGENDA_SCHEDULER_ENABLED", "true").lower() not in (
        "0",
        "false",
        "no",
        "off",
    )


async def agenda_scheduler_loop() -> None:
    while True:
        try:
            async with async_session_factory() as session:
                count = await process_due_orchestrator_events(session)
                if count:
                    logger.info("Agenda scheduler ran %s orchestrator wake(s)", count)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Agenda scheduler tick failed")
        await asyncio.sleep(_TICK_SECONDS)
