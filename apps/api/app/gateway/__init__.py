"""Gateway control plane: one WebSocket event bus for every client surface.

Clients (dashboard, widget, mobile, IDEs) connect to ``/api/ws`` and subscribe
to topics. Backend services publish typed events through :mod:`app.gateway.publish`;
the bus fans them out locally and across workers via Redis pub/sub when available.
"""

from app.gateway.bus import event_bus
from app.gateway.publish import (
    publish_decision,
    publish_notification,
    publish_presence,
    publish_run_event,
    publish_signal_message,
    publish_thread_update,
)

__all__ = [
    "event_bus",
    "publish_decision",
    "publish_notification",
    "publish_presence",
    "publish_run_event",
    "publish_signal_message",
    "publish_thread_update",
]
