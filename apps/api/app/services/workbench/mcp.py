"""Generic MCP-attached workbench adapter."""

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

    def capabilities(self) -> AdapterCapabilities:
        return AdapterCapabilities(
            follow_up=True,
            needs_input_events=True,
            images=True,
            mcp_attach=True,
            budget=True,
            plan_mode=True,
            user_attribution=True,
            needs_repo=False,
            self_hosted_executor=True,
        )

    async def start(self, spec: JobSpec) -> JobHandle:
        # Stub: real implementation invokes the configured MCP workbench tool.
        return JobHandle(
            external_ids={"status": "stub", "repo": spec.repo_url, "ref": spec.ref},
            provider=self.provider,
        )

    async def follow_up(
        self, handle: JobHandle, text: str, images: list[dict[str, Any]] | None = None
    ) -> None:
        return None

    async def status(self, handle: JobHandle) -> str:
        return handle.external_ids.get("status", "queued")

    async def cancel(self, handle: JobHandle) -> None:
        return None

    async def handle_webhook(self, payload: dict[str, Any]) -> list[NormalizedEvent]:
        requested_kind = str(payload.get("kind") or "progress")
        allowed = {
            "started",
            "progress",
            "needs_input",
            "artifact",
            "finished",
            "failed",
            "cancelled",
        }
        kind = requested_kind if requested_kind in allowed else "progress"
        return [
            NormalizedEvent(
                kind=kind,
                summary=str(payload.get("summary") or requested_kind),
                payload=payload,
            )
        ]


register_adapter("mcp", McpWorkbenchAdapter)
