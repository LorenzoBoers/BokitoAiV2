"""Lightweight in-process rate limiting for abuse-prone endpoints.

Sliding-window counter per (scope, client IP). In-memory by design: a single
API process is the current deployment shape, and even with several workers the
per-process limit still caps abuse at limit * workers. Swap for a Redis-backed
limiter if the API ever scales horizontally behind a load balancer.
"""

from __future__ import annotations

import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request

_WINDOWS: dict[tuple[str, str], deque[float]] = defaultdict(deque)
_MAX_KEYS = 50_000


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _prune(now: float, window: deque[float], period_seconds: float) -> None:
    cutoff = now - period_seconds
    while window and window[0] <= cutoff:
        window.popleft()


def rate_limit(scope: str, *, limit: int, period_seconds: float = 60.0):
    """Dependency factory: at most `limit` requests per `period_seconds` per client IP."""

    async def dependency(request: Request) -> None:
        now = time.monotonic()
        key = (scope, _client_ip(request))
        window = _WINDOWS[key]
        _prune(now, window, period_seconds)
        if len(window) >= limit:
            raise HTTPException(
                status_code=429,
                detail="Too many requests. Try again shortly.",
                headers={"Retry-After": str(int(period_seconds))},
            )
        window.append(now)
        # Bound memory: drop the oldest buckets if the table grows unbounded.
        if len(_WINDOWS) > _MAX_KEYS:
            for stale_key in list(_WINDOWS.keys())[: _MAX_KEYS // 10]:
                del _WINDOWS[stale_key]

    return dependency


def reset_rate_limits() -> None:
    """Test helper: clear all counters."""
    _WINDOWS.clear()
