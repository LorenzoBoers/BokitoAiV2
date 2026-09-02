"""Chat session single-flight + cooperative cancel."""

from __future__ import annotations

from uuid import uuid4

import pytest

from app.services.agent.run_cancel import (
    clear_cancel,
    is_cancel_requested,
    is_run_cancelled,
    request_cancel,
)


def test_request_cancel_sets_memory_flag():
    run_id = uuid4()
    assert not is_cancel_requested(run_id)
    request_cancel(run_id)
    assert is_cancel_requested(run_id)
    clear_cancel(run_id)
    assert not is_cancel_requested(run_id)


@pytest.mark.asyncio
async def test_is_run_cancelled_reads_memory(session_factory=None):
    # Unit path without DB: memory flag alone is enough.
    run_id = uuid4()
    request_cancel(run_id)

    class _FakeSession:
        async def execute(self, *_a, **_k):
            class _R:
                def scalar_one_or_none(self):
                    return None

            return _R()

    assert await is_run_cancelled(_FakeSession(), run_id) is True
    clear_cancel(run_id)
