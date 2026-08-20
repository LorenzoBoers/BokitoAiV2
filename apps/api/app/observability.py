"""Error tracking and structured logging bootstrap.

Both entry points (API in `app.main`, worker in `app.workers.tasks`) call
`init_observability(role=...)` once at startup. Everything here is
best-effort: without a SENTRY_DSN (or without the sentry-sdk package
installed) Sentry is a no-op, and logging falls back to uvicorn defaults
unless JSON logs are enabled.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from app.config import get_settings

logger = logging.getLogger(__name__)

_REDACTED_HEADERS = {"authorization", "cookie", "set-cookie", "x-api-key", "x-worker-secret"}
_REDACTED_VALUE = "[redacted]"


def _scrub_sentry_event(event: dict, hint: dict) -> dict:  # noqa: ARG001 - sentry contract
    """Strip credentials and message bodies before events leave the process."""
    request = event.get("request")
    if isinstance(request, dict):
        headers = request.get("headers")
        if isinstance(headers, dict):
            for key in list(headers):
                if key.lower() in _REDACTED_HEADERS:
                    headers[key] = _REDACTED_VALUE
        # Request bodies can contain customer email content and secrets.
        request.pop("data", None)
        request.pop("cookies", None)
    return event


def init_sentry(role: str) -> bool:
    """Initialize Sentry when a DSN is configured. Returns True when active."""
    settings = get_settings()
    dsn = settings.sentry_dsn.strip()
    if not dsn:
        return False
    try:
        import sentry_sdk
    except ImportError:
        logger.warning("SENTRY_DSN is set but sentry-sdk is not installed; skipping.")
        return False
    sentry_sdk.init(
        dsn=dsn,
        environment=settings.environment,
        traces_sample_rate=settings.sentry_traces_sample_rate,
        profiles_sample_rate=0,
        send_default_pii=False,
        before_send=_scrub_sentry_event,
    )
    sentry_sdk.set_tag("service.role", role)
    return True


class JsonLogFormatter(logging.Formatter):
    """One JSON object per line: friendly to Docker log drivers and grep/jq."""

    def format(self, record: logging.LogRecord) -> str:
        entry: dict = {
            "ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            entry["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(entry, ensure_ascii=False)


def setup_logging() -> None:
    """Switch root logging to JSON lines in production (or when LOG_JSON=1)."""
    settings = get_settings()
    if not (settings.log_json or settings.is_production):
        return
    handler = logging.StreamHandler()
    handler.setFormatter(JsonLogFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(logging.INFO)


def init_observability(role: str) -> None:
    setup_logging()
    init_sentry(role)
