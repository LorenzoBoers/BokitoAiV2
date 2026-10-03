"""GitHub Copilot cloud agent adapter (phase 2 stub)."""

from __future__ import annotations

from typing import Any

from app.services.workbench import (
    AdapterCapabilities,
    JobHandle,
    JobSpec,
    NormalizedEvent,
    register_adapter,
)


class GitHubWorkbenchAdapter:
    provider = "github_copilot"
    category = "cloud"
    api_version = "agent-tasks-preview"

    def capabilities(self) -> AdapterCapabilities:
        return AdapterCapabilities(
            creates_pr=True,
            follow_up=True,
            cancel=False,
            needs_input_native=True,
            needs_input_events=True,
            webhook=True,
        )

    async def start(self, spec: JobSpec, creds: dict[str, Any]) -> JobHandle:
        return JobHandle(
            external_ids={"status": "stub", "repo": spec.repo_url, "ref": spec.ref},
            provider=self.provider,
            external_id="stub",
        )

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


register_adapter("github_copilot", GitHubWorkbenchAdapter)
