"""GitHub workbench adapter — first provider (substrate for issues + Copilot tasks)."""

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

    def capabilities(self) -> AdapterCapabilities:
        return AdapterCapabilities(
            creates_pr=True,
            follow_up=True,
            needs_input_events=False,
            images=False,
            mcp_attach=False,
            budget=False,
            plan_mode=False,
            user_attribution=False,
            needs_repo=True,
        )

    async def start(self, spec: JobSpec) -> JobHandle:
        # Stub: real implementation calls POST /agents/repos/{owner}/{repo}/tasks
        # or creates an issue assigned to copilot-swe-agent[bot].
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
        action = str(payload.get("action") or "")
        if action in ("closed", "merged"):
            return [NormalizedEvent(kind="finished", summary=action, payload=payload)]
        if action == "opened":
            return [
                NormalizedEvent(
                    kind="artifact",
                    summary="pull request",
                    payload={"kind": "pr", **payload},
                )
            ]
        return [NormalizedEvent(kind="progress", summary=action or "update", payload=payload)]


register_adapter("github_copilot", GitHubWorkbenchAdapter)
