"""In-process agenda orchestrator wake scheduler."""

import asyncio
import logging
import os

from app.db.session import async_session_factory
from app.services.agenda import process_due_orchestrator_events
from app.services.orchestration.bootstrap import seed_global_automation_templates

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
    templates_seeded = False
    while True:
        try:
            async with async_session_factory() as session:
                if not templates_seeded:
                    await seed_global_automation_templates(session)
                    await session.commit()
                    templates_seeded = True
                count = await process_due_orchestrator_events(session)
                if count:
                    logger.info("Agenda scheduler ran %s orchestrator wake(s)", count)
                from app.services.orchestration.scheduler import process_due_automations_inline

                auto_count = await process_due_automations_inline(session)
                if auto_count:
                    logger.info("Automation scheduler ran %s automation(s)", auto_count)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Agenda scheduler tick failed")
        await asyncio.sleep(_TICK_SECONDS)
