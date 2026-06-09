"""Inline automation scheduling (no Redis required)."""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orchestra import Task as AutomationTask
from app.services.orchestration.dispatcher import trigger_automation_task


async def process_due_automations_inline(session: AsyncSession) -> int:
    now = datetime.utcnow()
    result = await session.execute(
        select(AutomationTask).where(
            AutomationTask.enabled.is_(True),
            AutomationTask.schedule_kind == "interval",
            AutomationTask.next_run_at.is_not(None),
            AutomationTask.next_run_at <= now,
        )
    )
    count = 0
    for auto in result.scalars().all():
        await trigger_automation_task(session, auto.id, auto.tenant_id)
        try:
            minutes = int(auto.schedule_expr or "60")
        except ValueError:
            minutes = 60
        auto.next_run_at = now + timedelta(minutes=minutes)
        if not auto.last_run_at:
            auto.last_run_at = now
        session.add(auto)
        count += 1
    if count:
        await session.commit()
    return count
