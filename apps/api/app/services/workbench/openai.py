"""OpenAI Agents API workbench adapter."""

from __future__ import annotations

from typing import Any

from app.services.workbench import (
    AdapterCapabilities,
    JobHandle,
    JobSpec,
    NormalizedEvent,
    register_adapter,
)


class OpenAIWorkbenchAdapter:
    provider = "openai"

    def capabilities(self) -> AdapterCapabilities:
        return AdapterCapabilities(
            follow_up=True,
            needs_input_events=True,
            images=True,
            mcp_attach=True,
            budget=True,
            user_attribution=True,
        )

    async def start(self, spec: JobSpec) -> JobHandle:
        # Stub: real implementation creates an Agents API run.
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
        event = str(payload.get("type") or payload.get("status") or "progress")
        kind = {
            "completed": "finished",
            "failed": "failed",
            "cancelled": "cancelled",
            "requires_action": "needs_input",
        }.get(event, "progress")
        return [NormalizedEvent(kind=kind, summary=event, payload=payload)]


register_adapter("openai", OpenAIWorkbenchAdapter)
