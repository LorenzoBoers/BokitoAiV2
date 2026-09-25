"""Workbench adapter interface and normalized events.

Adapters: github_copilot, cursor, anthropic, openai, mcp.
First adapter to implement: GitHub (issues + Copilot tasks API).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass
class JobSpec:
    """Normalized dispatch payload every adapter accepts."""

    repo_url: str
    ref: str
    brief: str
    context_packet: dict[str, Any]
    options: dict[str, Any] = field(default_factory=dict)
    images: list[dict[str, Any]] = field(default_factory=list)


@dataclass
class JobHandle:
    external_ids: dict[str, str]
    provider: str


@dataclass
class NormalizedEvent:
    kind: str  # started | progress | needs_input | artifact | finished | failed | cancelled
    summary: str = ""
    payload: dict[str, Any] = field(default_factory=dict)


@dataclass
class AdapterCapabilities:
    creates_pr: bool = False
    follow_up: bool = False
    needs_input_events: bool = False
    images: bool = False
    mcp_attach: bool = False
    budget: bool = False
    plan_mode: bool = False
    user_attribution: bool = False
    needs_repo: bool = True
    self_hosted_executor: bool = False


class WorkbenchAdapter(Protocol):
    provider: str

    def capabilities(self) -> AdapterCapabilities: ...

    async def start(self, spec: JobSpec) -> JobHandle: ...

    async def follow_up(self, handle: JobHandle, text: str, images: list[dict[str, Any]] | None = None) -> None: ...

    async def status(self, handle: JobHandle) -> str: ...

    async def cancel(self, handle: JobHandle) -> None: ...

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
    from app.services.workbench import anthropic, cursor, github, mcp, openai  # noqa: F401


# A package import is enough to make the complete adapter catalog available.
register_all()
