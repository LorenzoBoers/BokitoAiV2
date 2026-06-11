"""Channel adapters: every external surface normalizes into the Signal model.

Each adapter exposes `normalize_inbound()` (provider payload -> InboundMessage)
and `format_outbound()` (SignalMessage body -> provider payload). The shared
`ingest_inbound()` entrypoint applies contact pairing and creates the Signal.
"""

from app.channels.base import InboundMessage, ingest_inbound
from app.channels.outbound import deliver_outbound

__all__ = ["InboundMessage", "deliver_outbound", "ingest_inbound"]
