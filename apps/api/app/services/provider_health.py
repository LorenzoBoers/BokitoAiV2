"""Per key + model cooldown after rate limits or tier refusals.

Providers limit per model: one key can serve a small model while a larger one
answers 429 with a request quota of zero, or 403 "not in your subscription
tier". Such a (key, model) pair is parked for a while so resolution moves to
the next step in the backing chain instead of failing every turn on it.
State is per process; the API and worker each learn on their own first failure.
"""

from __future__ import annotations

import hashlib
import logging
import time

logger = logging.getLogger(__name__)

# Quota of zero or model outside the plan: blocked until billing/limits change.
HARD_QUOTA_COOLDOWN_S = 15 * 60
# Ordinary 429 that survived the in-call retries.
RATE_LIMIT_COOLDOWN_S = 2 * 60

_cooling_until: dict[str, float] = {}


def _pair_id(api_key: str, model: str) -> str:
    raw = f"{api_key}|{(model or '').strip().lower()}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def mark_rate_limited(
    provider: str, api_key: str, model: str = "", *, hard_quota: bool = False
) -> None:
    if not api_key:
        return
    seconds = HARD_QUOTA_COOLDOWN_S if hard_quota else RATE_LIMIT_COOLDOWN_S
    _cooling_until[_pair_id(api_key, model)] = time.monotonic() + seconds
    logger.warning(
        "Provider %s model %s parked for %ss after %s",
        provider or "unknown",
        model or "(any)",
        seconds,
        "a zero quota or plan refusal" if hard_quota else "repeated rate limits",
    )


def is_cooling(api_key: str, model: str = "") -> bool:
    if not api_key:
        return False
    key = _pair_id(api_key, model)
    until = _cooling_until.get(key)
    if until is None:
        return False
    if time.monotonic() >= until:
        _cooling_until.pop(key, None)
        return False
    return True


def reset() -> None:
    _cooling_until.clear()
