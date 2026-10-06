"""Shared HTTP helpers for workbench cloud adapters."""

from __future__ import annotations

from typing import Any

import httpx

_RETRYABLE = {408, 425, 429, 500, 502, 503, 504}


class WorkbenchHttpError(Exception):
    def __init__(self, message: str, *, status_code: int | None = None, body: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.body = body


async def request_json(
    method: str,
    url: str,
    *,
    headers: dict[str, str] | None = None,
    json_body: dict[str, Any] | None = None,
    auth: httpx.Auth | tuple[str, str] | None = None,
    timeout: float = 45.0,
    retries: int = 2,
) -> dict[str, Any] | list[Any] | None:
    """Perform an HTTP call; retry network/5xx at most ``retries`` times. Never retry 4xx."""
    last_exc: Exception | None = None
    async with httpx.AsyncClient(timeout=timeout) as client:
        for attempt in range(retries + 1):
            try:
                resp = await client.request(
                    method,
                    url,
                    headers=headers,
                    json=json_body,
                    auth=auth,
                )
            except httpx.HTTPError as exc:
                last_exc = exc
                if attempt >= retries:
                    raise WorkbenchHttpError(f"Network error talking to provider: {exc}") from exc
                continue
            if resp.status_code in _RETRYABLE and attempt < retries:
                continue
            if resp.status_code >= 400:
                detail: Any
                try:
                    detail = resp.json()
                except Exception:
                    detail = (resp.text or "")[:500]
                raise WorkbenchHttpError(
                    f"Provider HTTP {resp.status_code}",
                    status_code=resp.status_code,
                    body=detail,
                )
            if resp.status_code == 204 or not (resp.content or b"").strip():
                return None
            try:
                data = resp.json()
            except Exception as exc:
                raise WorkbenchHttpError("Provider returned non-JSON body") from exc
            return data
    raise WorkbenchHttpError(f"Provider request failed: {last_exc}")


def build_prompt(spec: Any) -> str:
    """Render brief + context packet for a provider prompt."""
    parts = [str(getattr(spec, "brief", "") or "").strip()]
    packet = getattr(spec, "context_packet", None) or {}
    if isinstance(packet, dict) and packet:
        lines = ["", "```bokito-context"]
        for key in (
            "acceptance",
            "signal_id",
            "project_id",
            "job_ref",
            "thread_excerpt",
            "repo_resource",
        ):
            if packet.get(key):
                lines.append(f"{key}: {packet[key]}")
        for key, value in packet.items():
            if key in {
                "acceptance",
                "signal_id",
                    "project_id",
                "job_ref",
                "thread_excerpt",
                "repo_resource",
            }:
                continue
            if value is not None and value != "":
                lines.append(f"{key}: {value}")
        lines.append("```")
        parts.append("\n".join(lines))
    mcp = getattr(spec, "mcp", None)
    if mcp is not None:
        tools = ", ".join(mcp.tools) if mcp.tools else "report_progress, ask_question, attach_artifact"
        parts.append(
            "\nBokito MCP is attached as server `bokito`. "
            f"Use it for live progress and questions ({tools})."
        )
    return "\n".join(p for p in parts if p).strip()
