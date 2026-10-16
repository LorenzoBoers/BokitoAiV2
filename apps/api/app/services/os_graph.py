"""AI OS workspace canvas graph overlay — retired.

HTTP ``/os/graph`` and related routes return 410. Domain entities live on
Agent, Playbook, Connection, and project canvas. This module only keeps the
retired response helper.
"""

from __future__ import annotations

from uuid import UUID

from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

OS_GRAPH_RETIRED_HINT = (
    "The OS graph overlay is gone. Create or change an Agent, Playbook, "
    "or Connection; open Agents or a project canvas. Overlay nodes are not used."
)
OS_GRAPH_RETIRED = {"status": "retired", "hint": OS_GRAPH_RETIRED_HINT}


def os_graph_retired_response() -> JSONResponse:
    return JSONResponse(status_code=410, content=OS_GRAPH_RETIRED)


async def ensure_canvas_seeded(session: AsyncSession, tenant_id: UUID) -> None:
    """No-op: overlay rows are no longer created or queried."""
    del session, tenant_id
