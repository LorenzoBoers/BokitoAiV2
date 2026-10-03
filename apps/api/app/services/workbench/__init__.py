"""Workbench adapter interface and normalized events.

Phase-1 live adapters: cursor, claude_managed, devin.
Later: github_copilot (phase 2), openai/mcp stubs.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal, Protocol


@dataclass
class McpAttach:
    url: str
    token: str
    tools: list[str] = field(default_factory=list)


@dataclass
class Budget:
    max_minutes: int = 60
    max_cost_cents: int | None = None


@dataclass
class JobSpec:
    """Normalized dispatch payload every adapter accepts."""

    repo_url: str
    ref: str
    brief: str
    context_packet: dict[str, Any]
    options: dict[str, Any] = field(default_factory=dict)
    images: list[dict[str, Any]] = field(default_factory=list)
    model: str | None = None
    mode: str = "agent"  # agent | plan
    create_pr: bool = True
    env: dict[str, str] = field(default_factory=dict)
    secrets_ref: str | None = None
    mcp: McpAttach | None = None
    budget: Budget | None = None
    # Idempotency key for providers that support it (Cursor agentId).
    client_job_id: str | None = None
    webhook_url: str | None = None
    webhook_secret: str | None = None


@dataclass
class JobHandle:
    external_ids: dict[str, str]
    provider: str
    external_id: str = ""


@dataclass
class NormalizedEvent:
    kind: str  # started | progress | needs_input | artifact | finished | failed | cancelled
    summary: str = ""
    payload: dict[str, Any] = field(default_factory=dict)
    external_event_id: str = ""


@dataclass
class AdapterCapabilities:
    start: bool = True
    follow_up: bool = False
    cancel: bool = False
    needs_input_native: bool = False
    mcp_attach_per_job: bool = False
    creates_pr: bool = False
    stream: bool = False
    webhook: bool = False
    budget_native: bool = False
    images: bool = False
    plan_mode: bool = False
    needs_repo: bool = True
    # Back-compat aliases used by older stub code / UI.
    needs_input_events: bool = False
    mcp_attach: bool = False
    budget: bool = False
    user_attribution: bool = False
    self_hosted_executor: bool = False

    def as_dict(self) -> dict[str, bool]:
        return {
            "start": self.start,
            "follow_up": self.follow_up,
            "cancel": self.cancel,
            "needs_input_native": self.needs_input_native or self.needs_input_events,
            "mcp_attach_per_job": self.mcp_attach_per_job or self.mcp_attach,
            "creates_pr": self.creates_pr,
            "stream": self.stream,
            "webhook": self.webhook,
            "budget_native": self.budget_native or self.budget,
            "images": self.images,
            "plan_mode": self.plan_mode,
            "needs_repo": self.needs_repo,
        }


class WorkbenchAdapter(Protocol):
    provider: str
    category: Literal["cloud", "cli", "ci", "relay"]
    api_version: str

    def capabilities(self) -> AdapterCapabilities: ...

    async def start(self, spec: JobSpec, creds: dict[str, Any]) -> JobHandle: ...

    async def follow_up(
        self,
        handle: JobHandle,
        text: str,
        creds: dict[str, Any],
        images: list[dict[str, Any]] | None = None,
    ) -> None: ...

    async def cancel(self, handle: JobHandle, creds: dict[str, Any]) -> None: ...

    async def poll(self, handle: JobHandle, creds: dict[str, Any]) -> list[NormalizedEvent]: ...

    def verify_webhook(self, headers: dict[str, str], raw_body: bytes, secret: str) -> bool: ...

    async def handle_webhook(self, payload: dict[str, Any]) -> list[NormalizedEvent]: ...


# Registry filled by provider modules as they are added.
ADAPTERS: dict[str, type] = {}


def register_adapter(provider: str, cls: type) -> None:
    ADAPTERS[provider] = cls


def get_adapter(provider: str) -> WorkbenchAdapter | None:
    cls = ADAPTERS.get(provider)
    if cls is None:
        return None
    return cls()  # type: ignore[call-arg]


def register_all() -> None:
    """Import every built-in provider so its adapter registers itself."""
    from app.services.workbench import (  # noqa: F401
        claude_managed,
        cursor,
        devin,
        github,
        mcp,
        openai,
    )


# A package import is enough to make the complete adapter catalog available.
register_all()
