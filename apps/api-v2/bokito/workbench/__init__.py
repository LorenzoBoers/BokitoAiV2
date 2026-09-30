"""Workbench adapters: hand coding work to tools people already use.

Bokito does not host an IDE. A workbench `Connection` (kind=workbench) holds
the provider credentials; an adapter turns a brief from a conversation into a
job on that provider and normalises status callbacks back into the thread.

Adapters implement `WorkbenchAdapter`. One is real today: `cursor` (Cursor
cloud agents). Everything network-bound is skipped in mock mode so tests and
local development do not need an API key.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from bokito.errors import AppError


class WorkbenchError(AppError):
    status_code = 502
    code = "workbench_error"


@dataclass
class JobSpec:
    brief: str
    repository: str
    ref: str = ""
    auto_pr: bool = True
    branch_name: str = ""
    model: str = ""
    webhook_url: str = ""
    webhook_secret: str = ""
    context: dict[str, Any] = field(default_factory=dict)


@dataclass
class JobHandle:
    provider: str
    external_id: str
    status: str
    url: str = ""
    branch_name: str = ""
    pr_url: str = ""
    raw: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "external_id": self.external_id,
            "status": self.status,
            "url": self.url,
            "branch_name": self.branch_name,
            "pr_url": self.pr_url,
        }


@dataclass
class JobEvent:
    """Normalised status callback: finished | failed | progress."""

    provider: str
    external_id: str
    kind: str
    summary: str = ""
    url: str = ""
    branch_name: str = ""
    pr_url: str = ""
    raw: dict[str, Any] = field(default_factory=dict)


class WorkbenchAdapter(Protocol):
    provider: str

    async def verify(self, credentials: dict[str, Any]) -> tuple[bool, str]: ...

    async def launch(self, credentials: dict[str, Any], spec: JobSpec) -> JobHandle: ...

    async def status(self, credentials: dict[str, Any], external_id: str) -> JobHandle: ...

    async def followup(
        self, credentials: dict[str, Any], external_id: str, text: str
    ) -> JobHandle: ...

    def verify_webhook(self, secret: str, raw_body: bytes, signature: str) -> bool: ...

    def parse_webhook(self, payload: dict[str, Any]) -> JobEvent: ...


_ADAPTERS: dict[str, WorkbenchAdapter] = {}


def register_adapter(adapter: WorkbenchAdapter) -> WorkbenchAdapter:
    _ADAPTERS[adapter.provider] = adapter
    return adapter


def get_adapter(provider: str) -> WorkbenchAdapter:
    try:
        return _ADAPTERS[provider]
    except KeyError as exc:
        raise WorkbenchError(
            f"no workbench adapter for {provider}", code="workbench_unknown"
        ) from exc


def providers() -> list[str]:
    return sorted(_ADAPTERS)


from bokito.workbench import cursor  # noqa: E402,F401  (registers the adapter)
