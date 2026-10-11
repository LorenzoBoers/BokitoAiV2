"""Dev probe: rules have threads, dates mirrored, list/agenda read them."""

import asyncio
from datetime import datetime, timedelta

from sqlalchemy import func, select

from app.db.session import async_session_factory
from app.models.signal import Signal
from app.models.trigger import Trigger


async def main() -> None:
    async with async_session_factory() as session:
        no_thread = (
            await session.execute(
                select(func.count()).select_from(Trigger).where(
                    Trigger.deleted_at.is_(None), Trigger.signal_id.is_(None)
                )
            )
        ).scalar_one()
        print("rules without thread:", no_thread)
        rows = (
            await session.execute(
                select(Trigger, Signal)
                .join(Signal, Signal.id == Trigger.signal_id)
                .where(Trigger.deleted_at.is_(None), Trigger.purpose == "")
            )
        ).all()
        for trigger, signal in rows:
            print(
                f"- {trigger.kind:9} enabled={trigger.enabled!s:5} next={trigger.next_run_at} "
                f"thread={signal.channel}/{signal.source} next_at={signal.next_at} "
                f"owner={signal.assignee_kind} subject={signal.subject[:40]!r}"
            )
        dated = (
            await session.execute(
                select(func.count()).select_from(Signal).where(Signal.next_at.is_not(None))
            )
        ).scalar_one()
        print("threads with a date:", dated)

        from app.services.signal_threads import list_threads
        from app.services.time_items import list_time_items

        if rows:
            tenant_id = rows[0][0].tenant_id
            now = datetime.utcnow()
            items = await list_time_items(
                session, tenant_id, start=now - timedelta(days=1), end=now + timedelta(days=14)
            )
            kinds: dict[str, int] = {}
            for item in items:
                kinds[item["kind"]] = kinds.get(item["kind"], 0) + 1
            print("agenda kinds:", kinds)
            import inspect

            print("list_threads params:", list(inspect.signature(list_threads).parameters)[:12])


asyncio.run(main())
