"""OpenAI / Codex workbench adapter — deferred until a public cloud API exists."""

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
    category = "cloud"
    api_version = "deferred"

    def capabilities(self) -> AdapterCapabilities:
        return AdapterCapabilities(start=False)

    async def start(self, spec: JobSpec, creds: dict[str, Any]) -> JobHandle:
        raise NotImplementedError("Codex cloud waits for a public API")

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


register_adapter("openai", OpenAIWorkbenchAdapter)
