"""In-process runtime health signals for the API.

Tracks the things that used to fail silently: Redis enqueue failures and the
in-process trigger scheduler heartbeat. Exposed via GET /health/ready so
operators can see degraded background processing instead of guessing.
"""

from __future__ import annotations

from datetime import datetime, timezone
from threading import Lock

_lock = Lock()
_state: dict[str, object] = {
    "redis_enqueue_failures": 0,
    "last_redis_failure_at": None,
    "last_redis_failure_reason": None,
    "scheduler_last_tick_at": None,
    "scheduler_last_error": None,
}


def record_redis_enqueue_failure(reason: str) -> None:
    with _lock:
        _state["redis_enqueue_failures"] = int(_state["redis_enqueue_failures"]) + 1  # type: ignore[arg-type]
        _state["last_redis_failure_at"] = datetime.now(timezone.utc).isoformat()
        _state["last_redis_failure_reason"] = reason[:200]


def record_scheduler_tick(error: str | None = None) -> None:
    with _lock:
        _state["scheduler_last_tick_at"] = datetime.now(timezone.utc).isoformat()
        _state["scheduler_last_error"] = error[:200] if error else None


def runtime_health_snapshot() -> dict[str, object]:
    with _lock:
        return dict(_state)
