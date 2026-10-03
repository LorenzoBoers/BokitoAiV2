"""Claude Managed Agents workbench adapter (public beta).

Docs: https://platform.claude.com/docs/en/managed-agents/
Beta header: managed-agents-2026-04-01
Auth: x-api-key (tenant Anthropic key)
"""

from __future__ import annotations

from typing import Any

from app.services.workbench import (
    AdapterCapabilities,
    JobHandle,
    JobSpec,
    NormalizedEvent,
    register_adapter,
)
from app.services.workbench.http_util import WorkbenchHttpError, build_prompt, request_json

BASE = "https://api.anthropic.com/v1"
BETA = "managed-agents-2026-04-01"
ANTHROPIC_VERSION = "2023-06-01"

_STATUS = {
    "idle": "needs_input",  # refined in poll from events
    "running": "running",
    "rescheduling": "running",
    "terminated": "failed",
}


class ClaudeManagedWorkbenchAdapter:
    provider = "claude_managed"
    category = "cloud"
    api_version = "managed-agents-2026-04-01"

    def capabilities(self) -> AdapterCapabilities:
        return AdapterCapabilities(
            start=True,
            follow_up=True,
            cancel=True,
            needs_input_native=True,
            mcp_attach_per_job=True,
            creates_pr=True,
            stream=True,
            webhook=False,
            budget_native=True,
            images=True,
            plan_mode=False,
            needs_repo=True,
            mcp_attach=True,
            needs_input_events=True,
            budget=True,
        )

    def _headers(self, creds: dict[str, Any]) -> dict[str, str]:
        key = str(creds.get("api_key") or creds.get("anthropic_api_key") or "").strip()
        if not key:
            raise WorkbenchHttpError("Anthropic API key missing on connection")
        return {
            "x-api-key": key,
            "anthropic-version": ANTHROPIC_VERSION,
            "anthropic-beta": BETA,
            "content-type": "application/json",
        }

    async def _ensure_agent(self, creds: dict[str, Any], spec: JobSpec) -> str:
        """Reuse an agent id from connection metadata, or create one."""
        meta_agent = str(creds.get("agent_id") or "").strip()
        if meta_agent:
            return meta_agent
        model = spec.model or str(creds.get("default_model") or "claude-opus-4-5")
        body: dict[str, Any] = {
            "name": "Bokito workbench",
            "model": model,
            "tools": [{"type": "agent_toolset_20260401"}],
        }
        if spec.mcp:
            body["mcp_servers"] = [
                {
                    "type": "url",
                    "url": spec.mcp.url,
                    "name": "bokito",
                    "authorization_token": spec.mcp.token,
                }
            ]
        data = await request_json(
            "POST",
            f"{BASE}/agents",
            headers=self._headers(creds),
            json_body=body,
        )
        assert isinstance(data, dict)
        agent_id = str(data.get("id") or "")
        if not agent_id:
            raise WorkbenchHttpError("Claude agents.create returned no id", body=data)
        return agent_id

    async def _ensure_environment(self, creds: dict[str, Any], spec: JobSpec) -> str:
        env_id = str(creds.get("environment_id") or "").strip()
        if env_id:
            return env_id
        # Anthropic-hosted cloud sandbox with limited networking (code hosts).
        body: dict[str, Any] = {
            "name": "Bokito cloud",
            "config": {
                "type": "cloud",
                "networking": {"type": "limited"},
            },
        }
        # Pass git credentials into the sandbox when the tenant provided them.
        git_token = str(creds.get("git_token") or creds.get("github_token") or "").strip()
        if git_token:
            body["config"]["env"] = {
                "GITHUB_TOKEN": git_token,
                "GH_TOKEN": git_token,
            }
        data = await request_json(
            "POST",
            f"{BASE}/environments",
            headers=self._headers(creds),
            json_body=body,
        )
        assert isinstance(data, dict)
        environment_id = str(data.get("id") or "")
        if not environment_id:
            raise WorkbenchHttpError("Claude environments.create returned no id", body=data)
        return environment_id

    async def start(self, spec: JobSpec, creds: dict[str, Any]) -> JobHandle:
        agent_id = await self._ensure_agent(creds, spec)
        environment_id = await self._ensure_environment(creds, spec)
        prompt = build_prompt(spec)
        if spec.repo_url:
            prompt = (
                f"{prompt}\n\nRepository: {spec.repo_url}\n"
                f"Starting ref: {spec.ref or 'main'}\n"
                "Clone the repository, implement the change, commit, and open a pull request "
                "when create_pr is requested."
            )
            if spec.create_pr:
                prompt += "\ncreate_pr: true"

        agent_payload: Any = agent_id
        if spec.mcp:
            # Per-session override so the job token is not stored on the durable agent.
            agent_payload = {
                "type": "agent",
                "id": agent_id,
                "mcp_servers": [
                    {
                        "type": "url",
                        "url": spec.mcp.url,
                        "name": "bokito",
                        "authorization_token": spec.mcp.token,
                    }
                ],
            }

        body: dict[str, Any] = {
            "agent": agent_payload,
            "environment_id": environment_id,
            "initial_events": [
                {
                    "type": "user.message",
                    "content": [{"type": "text", "text": prompt}],
                }
            ],
        }
        if spec.budget and spec.budget.max_cost_cents:
            # Anthropic budgets use list-price dollars as a decimal string.
            dollars = f"{spec.budget.max_cost_cents / 100:.2f}"
            body["budget"] = {"max_list_cost": {"amount": dollars, "currency": "USD"}}

        data = await request_json(
            "POST",
            f"{BASE}/sessions",
            headers=self._headers(creds),
            json_body=body,
        )
        assert isinstance(data, dict)
        session_id = str(data.get("id") or "")
        if not session_id:
            raise WorkbenchHttpError("Claude sessions.create returned no id", body=data)
        status = str(data.get("status") or "running")
        return JobHandle(
            provider=self.provider,
            external_id=session_id,
            external_ids={
                "session_id": session_id,
                "agent_id": agent_id,
                "environment_id": environment_id,
                "status": status,
                "url": str(data.get("url") or ""),
            },
        )

    async def follow_up(
        self,
        handle: JobHandle,
        text: str,
        creds: dict[str, Any],
        images: list[dict[str, Any]] | None = None,
    ) -> None:
        session_id = handle.external_ids.get("session_id") or handle.external_id
        content: list[dict[str, Any]] = [{"type": "text", "text": text}]
        for img in images or []:
            if isinstance(img, dict) and img.get("url"):
                content.append({"type": "image", "source": {"type": "url", "url": img["url"]}})
        await request_json(
            "POST",
            f"{BASE}/sessions/{session_id}/events",
            headers=self._headers(creds),
            json_body={"events": [{"type": "user.message", "content": content}]},
        )

    async def cancel(self, handle: JobHandle, creds: dict[str, Any]) -> None:
        session_id = handle.external_ids.get("session_id") or handle.external_id
        try:
            await request_json(
                "POST",
                f"{BASE}/sessions/{session_id}/events",
                headers=self._headers(creds),
                json_body={"events": [{"type": "user.interrupt"}]},
                retries=0,
            )
        except WorkbenchHttpError:
            pass
        # Archive when idle so the sandbox is released.
        try:
            await request_json(
                "POST",
                f"{BASE}/sessions/{session_id}/archive",
                headers=self._headers(creds),
                retries=0,
            )
        except WorkbenchHttpError:
            pass

    async def poll(self, handle: JobHandle, creds: dict[str, Any]) -> list[NormalizedEvent]:
        session_id = handle.external_ids.get("session_id") or handle.external_id
        data = await request_json(
            "GET",
            f"{BASE}/sessions/{session_id}",
            headers=self._headers(creds),
            retries=0,
        )
        assert isinstance(data, dict)
        status = str(data.get("status") or "").lower()
        handle.external_ids["status"] = status

        kind = "progress"
        if status == "running" or status == "rescheduling":
            kind = "progress"
        elif status == "terminated":
            kind = "failed"
            if data.get("stop_reason") in ("end_turn", "completed"):
                kind = "finished"
        elif status == "idle":
            # Idle after work often means finished; idle with a question is needs_input.
            # Probe recent events for a clear signal.
            kind = await self._idle_kind(session_id, creds, data)

        events = [
            NormalizedEvent(
                kind=kind,
                summary=str(data.get("summary") or data.get("stop_reason") or status),
                external_event_id=f"claude-session:{session_id}:{status}:{data.get('updated_at') or data.get('status')}",
                payload={
                    "provider_status": status,
                    "session_id": session_id,
                    "stop_reason": data.get("stop_reason"),
                    "usage": data.get("usage") or data.get("cost"),
                },
            )
        ]
        return events

    async def _idle_kind(
        self, session_id: str, creds: dict[str, Any], data: dict[str, Any]
    ) -> str:
        stop = str(data.get("stop_reason") or "").lower()
        if stop in ("end_turn", "completed", "stop_sequence"):
            return "finished"
        try:
            events = await request_json(
                "GET",
                f"{BASE}/sessions/{session_id}/events?limit=20",
                headers=self._headers(creds),
                retries=0,
            )
        except WorkbenchHttpError:
            return "needs_input"
        items = []
        if isinstance(events, dict):
            items = events.get("data") or events.get("events") or []
        if isinstance(events, list):
            items = events
        for item in reversed(items if isinstance(items, list) else []):
            if not isinstance(item, dict):
                continue
            et = str(item.get("type") or "")
            if "question" in et or et.endswith("tool_use") and "AskUser" in str(item):
                return "needs_input"
            if et in ("agent.message", "assistant.message") and item.get("stop_reason") == "end_turn":
                return "finished"
        # Default idle to needs_input so the operator can answer or stop.
        return "needs_input"

    def verify_webhook(self, headers: dict[str, str], raw_body: bytes, secret: str) -> bool:
        return False

    async def handle_webhook(self, payload: dict[str, Any]) -> list[NormalizedEvent]:
        return []


register_adapter("claude_managed", ClaudeManagedWorkbenchAdapter)
# Back-compat alias for the old stub provider id.
register_adapter("anthropic", ClaudeManagedWorkbenchAdapter)
