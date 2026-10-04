"""Claude Managed Agents workbench adapter (public beta).

Docs: https://platform.claude.com/docs/en/managed-agents/
Beta header: managed-agents-2026-04-01
Auth: x-api-key (tenant Anthropic key)

MCP auth uses vaults (`static_bearer` + `vault_ids`), not inline tokens on
`mcp_servers`. Budget amounts are US cents as a string with `type: "limit"`.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

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

    def _mcp_server(self, url: str) -> dict[str, str]:
        return {"type": "url", "name": "bokito", "url": url}

    def _mcp_tools(self) -> list[dict[str, Any]]:
        return [
            {"type": "agent_toolset_20260401"},
            {
                "type": "mcp_toolset",
                "mcp_server_name": "bokito",
                # Job tools report into Bokito; skip per-call confirmations.
                "default_config": {"permission_policy": "always_allow"},
            },
        ]

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
            body["mcp_servers"] = [self._mcp_server(spec.mcp.url)]
            body["tools"] = self._mcp_tools()
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
        networking: dict[str, Any] = {"type": "limited"}
        if spec.mcp:
            # Limited sandboxes block MCP unless hosts are allowed.
            networking["allow_mcp_servers"] = True
            host = urlparse(spec.mcp.url).hostname
            if host:
                networking["allowed_hosts"] = [host]
        body: dict[str, Any] = {
            "name": "Bokito cloud",
            "config": {
                "type": "cloud",
                "networking": networking,
            },
        }
        git_token = str(creds.get("git_token") or creds.get("github_token") or "").strip()
        if git_token:
            body["config"]["env"] = {
                "GITHUB_TOKEN": git_token,
                "GH_TOKEN": git_token,
            }
            hosts = list(networking.get("allowed_hosts") or [])
            for git_host in ("github.com", "api.github.com"):
                if git_host not in hosts:
                    hosts.append(git_host)
            networking["allowed_hosts"] = hosts
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

    async def _mint_job_vault(self, creds: dict[str, Any], spec: JobSpec) -> str:
        """Create a per-job vault with a static_bearer credential for Bokito MCP."""
        assert spec.mcp is not None
        vault = await request_json(
            "POST",
            f"{BASE}/vaults",
            headers=self._headers(creds),
            json_body={
                "display_name": "Bokito workbench job",
                "metadata": {"source": "bokito_workbench"},
            },
        )
        assert isinstance(vault, dict)
        vault_id = str(vault.get("id") or "")
        if not vault_id:
            raise WorkbenchHttpError("Claude vaults.create returned no id", body=vault)
        await request_json(
            "POST",
            f"{BASE}/vaults/{vault_id}/credentials",
            headers=self._headers(creds),
            json_body={
                "display_name": "Bokito MCP job token",
                "auth": {
                    "type": "static_bearer",
                    "mcp_server_url": spec.mcp.url,
                    "token": spec.mcp.token,
                },
            },
        )
        return vault_id

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
        vault_ids: list[str] = []
        if spec.mcp:
            vault_id = await self._mint_job_vault(creds, spec)
            vault_ids = [vault_id]
            # Per-session MCP declaration; auth comes from vault_ids, not inline token.
            agent_payload = {
                "type": "agent_with_overrides",
                "id": agent_id,
                "mcp_servers": [self._mcp_server(spec.mcp.url)],
                "tools": self._mcp_tools(),
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
        if vault_ids:
            body["vault_ids"] = vault_ids
        if spec.budget and spec.budget.max_cost_cents:
            # Official schema: type limit + amount in US cents as a string.
            body["budget"] = {
                "type": "limit",
                "max_list_cost": {
                    "amount": str(int(spec.budget.max_cost_cents)),
                    "currency": "USD",
                },
            }

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
        external_ids: dict[str, Any] = {
            "session_id": session_id,
            "agent_id": agent_id,
            "environment_id": environment_id,
            "status": status,
            "url": str(data.get("url") or ""),
        }
        if vault_ids:
            external_ids["vault_id"] = vault_ids[0]
        return JobHandle(
            provider=self.provider,
            external_id=session_id,
            external_ids=external_ids,
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
        if status in ("running", "rescheduling"):
            kind = "progress"
        elif status == "terminated":
            stop = self._stop_reason_type(data)
            kind = "finished" if stop in ("end_turn", "completed") else "failed"
        elif status == "idle":
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

    def _stop_reason_type(self, data: dict[str, Any]) -> str:
        stop = data.get("stop_reason")
        if isinstance(stop, dict):
            return str(stop.get("type") or "").lower()
        return str(stop or "").lower()

    async def _idle_kind(
        self, session_id: str, creds: dict[str, Any], data: dict[str, Any]
    ) -> str:
        stop = self._stop_reason_type(data)
        if stop == "requires_action":
            return "needs_input"
        if stop in ("end_turn", "completed", "stop_sequence"):
            return "finished"
        if stop == "budget_reached":
            return "failed"
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
            payload = item.get("stop_reason") if isinstance(item.get("stop_reason"), dict) else {}
            if et in ("session.status_idle", "status_idle") and str(
                (payload or {}).get("type") or ""
            ) == "requires_action":
                return "needs_input"
            if "question" in et or (et.endswith("tool_use") and "AskUser" in str(item)):
                return "needs_input"
            if et in ("agent.message", "assistant.message") and item.get("stop_reason") == "end_turn":
                return "finished"
        return "needs_input"

    def verify_webhook(self, headers: dict[str, str], raw_body: bytes, secret: str) -> bool:
        return False

    async def handle_webhook(self, payload: dict[str, Any]) -> list[NormalizedEvent]:
        return []


register_adapter("claude_managed", ClaudeManagedWorkbenchAdapter)
# Back-compat alias for the old stub provider id.
register_adapter("anthropic", ClaudeManagedWorkbenchAdapter)
