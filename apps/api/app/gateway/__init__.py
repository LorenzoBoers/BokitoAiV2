"""Gateway control plane: one WebSocket event bus for every client surface.

Clients (dashboard, widget, mobile, IDEs) connect to ``/api/ws`` and subscribe
to topics. Backend services publish typed events through :mod:`app.gateway.publish`;
the bus fans them out locally and across workers via Redis pub/sub when available.
"""

from app.gateway import entity_events as _entity_events  # noqa: F401  (session hooks)
from app.gateway.bus import event_bus
from app.gateway.publish import (
    publish_agent_status,
    publish_decision,
    publish_entity,
    publish_notification,
    publish_presence,
    publish_run_event,
    publish_signal_message,
    publish_thread_update,
    publish_turn_event,
)

__all__ = [
    "event_bus",
    "publish_agent_status",
    "publish_decision",
    "publish_entity",
    "publish_notification",
    "publish_presence",
    "publish_run_event",
    "publish_signal_message",
    "publish_thread_update",
    "publish_turn_event",
]
