"""Native connections that talk to a vendor REST API with MCP-shaped tools.

One registry keyed by the ``native://{slug}`` server URL, so the MCP call and
test paths look a connector up instead of growing a branch per vendor. Each
connector exposes ``TOOLS`` (tool rows with ``annotations``), ``validate(auth)``
and ``call(auth, tool, arguments)``.
"""

from __future__ import annotations

from types import ModuleType


def native_connector(server_url: str) -> ModuleType | None:
    from app.services.native_connectors import mailblue, metricool

    for module in (mailblue, metricool):
        if server_url.startswith(module.NATIVE_URL):
            return module
    return None
