"""Cooperative cancel flags for in-flight AgentRuns.

Streaming chat and cancel live in the same API process; an in-memory set
gives low-latency checks between tool rounds. The DB ``status=cancelled``
row is the durable source of truth for other workers.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

# Process-local cancel requests (stream handler + cancel endpoint).
_cancelled_run_ids: set[UUID] = set()


def request_cancel(run_id: UUID) -> None:
    _cancelled_run_ids.add(run_id)


def clear_cancel(run_id: UUID) -> None:
    _cancelled_run_ids.discard(run_id)


def is_cancel_requested(run_id: UUID | None) -> bool:
    return run_id is not None and run_id in _cancelled_run_ids


async def is_run_cancelled(session: AsyncSession, run_id: UUID | None) -> bool:
    """True when the operator stopped this run (memory flag or DB status)."""
    if run_id is None:
        return False
    if is_cancel_requested(run_id):
        return True
    from sqlalchemy import select

    from app.models.agent import AgentRun

    result = await session.execute(select(AgentRun.status).where(AgentRun.id == run_id))
    status = result.scalar_one_or_none()
    return status == "cancelled"
