"""Generic MCP-driven workbench adapter (phase 3 / relay fallback stub)."""

from __future__ import annotations

from typing import Any

from app.services.workbench import (
    AdapterCapabilities,
    JobHandle,
    JobSpec,
    NormalizedEvent,
    register_adapter,
)


class McpWorkbenchAdapter:
    provider = "mcp"
    category = "relay"
    api_version = "stub"

    def capabilities(self) -> AdapterCapabilities:
        return AdapterCapabilities(mcp_attach_per_job=True, mcp_attach=True, start=False)

    async def start(self, spec: JobSpec, creds: dict[str, Any]) -> JobHandle:
        raise NotImplementedError("Generic MCP workbench adapter is not live yet")

    async def follow_up(
        self,
        handle: JobHandle,
        text: str,
        creds: dict[str, Any],
        images: list[dict[str, Any]] | None = None,
    ) -> None:
        return None

    async def cancel(self, handle: JobHandle, creds: dict[str, Any]) -> None:
        return None

    async def poll(self, handle: JobHandle, creds: dict[str, Any]) -> list[NormalizedEvent]:
        return []

    def verify_webhook(self, headers: dict[str, str], raw_body: bytes, secret: str) -> bool:
        return False

    async def handle_webhook(self, payload: dict[str, Any]) -> list[NormalizedEvent]:
        return []


register_adapter("mcp", McpWorkbenchAdapter)
