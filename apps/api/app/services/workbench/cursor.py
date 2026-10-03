"""Cursor Cloud Agents workbench adapter (API v1).

Docs: https://cursor.com/docs/cloud-agent/api/endpoints
Auth: Basic (api_key:) or Bearer. Webhooks: HMAC sha256= on raw body (v0 shape).
"""

from __future__ import annotations

import hashlib
import hmac
import uuid
from typing import Any

from app.services.workbench import (
    AdapterCapabilities,
    JobHandle,
    JobSpec,
    NormalizedEvent,
    register_adapter,
)
from app.services.workbench.http_util import WorkbenchHttpError, build_prompt, request_json

BASE = "https://api.cursor.com/v1"

_RUN_STATUS = {
    "CREATING": "queued",
    "RUNNING": "running",
    "FINISHED": "finished",
    "ERROR": "failed",
    "EXPIRED": "failed",
    "CANCELLED": "cancelled",
}


class CursorWorkbenchAdapter:
    provider = "cursor"
    category = "cloud"
    api_version = "v1-2026-04"

    def capabilities(self) -> AdapterCapabilities:
        return AdapterCapabilities(
            start=True,
            follow_up=True,
            cancel=True,
            needs_input_native=False,
            mcp_attach_per_job=True,
            creates_pr=True,
            stream=True,
            webhook=True,
            budget_native=False,
            images=True,
            plan_mode=True,
            needs_repo=True,
            mcp_attach=True,
            needs_input_events=False,
            budget=False,
            user_attribution=True,
        )

    def _auth(self, creds: dict[str, Any]) -> tuple[str, str]:
        key = str(creds.get("api_key") or creds.get("token") or "").strip()
        if not key:
            raise WorkbenchHttpError("Cursor API key missing on connection")
        return (key, "")

    def _headers(self) -> dict[str, str]:
        return {"Content-Type": "application/json"}

    async def start(self, spec: JobSpec, creds: dict[str, Any]) -> JobHandle:
        prompt_text = build_prompt(spec)
        body: dict[str, Any] = {
            "prompt": {"text": prompt_text},
            "repos": [{"url": spec.repo_url, "startingRef": spec.ref or "main"}],
            "autoCreatePR": bool(spec.create_pr),
        }
        if spec.model:
            body["model"] = {"id": spec.model}
        if spec.mode == "plan":
            body.setdefault("model", {"id": spec.model or "composer-2"})
        if spec.client_job_id:
            # Cursor expects bc-<uuid> form.
            raw = spec.client_job_id.replace("-", "")
            body["agentId"] = f"bc-{raw[:8]}-{raw[8:12]}-{raw[12:16]}-{raw[16:20]}-{raw[20:32]}"
        if spec.mcp:
            body["mcpServers"] = [
                {
                    "name": "bokito",
                    "type": "http",
                    "url": spec.mcp.url,
                    "headers": {"Authorization": f"Bearer {spec.mcp.token}"},
                }
            ]
        if spec.env:
            body["envVars"] = [{"name": k, "value": v} for k, v in spec.env.items()]
        if spec.images:
            # Cursor accepts images on the prompt when supported.
            images = []
            for img in spec.images:
                if isinstance(img, dict) and img.get("url"):
                    images.append({"url": img["url"]})
            if images:
                body["prompt"]["images"] = images
        # Webhook: documented on the agents webhook page (statusChange).
        if spec.webhook_url and spec.webhook_secret:
            body["webhook"] = {"url": spec.webhook_url, "secret": spec.webhook_secret}

        data = await request_json(
            "POST",
            f"{BASE}/agents",
            headers=self._headers(),
            json_body=body,
            auth=self._auth(creds),
        )
        assert isinstance(data, dict)
        agent = data.get("agent") if isinstance(data.get("agent"), dict) else data
        run = data.get("run") if isinstance(data.get("run"), dict) else {}
        agent_id = str(agent.get("id") or data.get("id") or "")
        run_id = str(run.get("id") or agent.get("latestRunId") or "")
        if not agent_id:
            raise WorkbenchHttpError("Cursor create returned no agent id", body=data)
        return JobHandle(
            provider=self.provider,
            external_id=agent_id,
            external_ids={
                "agent_id": agent_id,
                "run_id": run_id,
                "url": str(agent.get("url") or f"https://cursor.com/agents?id={agent_id}"),
                "status": str(run.get("status") or agent.get("status") or "CREATING"),
            },
        )

    async def follow_up(
        self,
        handle: JobHandle,
        text: str,
        creds: dict[str, Any],
        images: list[dict[str, Any]] | None = None,
    ) -> None:
        agent_id = handle.external_ids.get("agent_id") or handle.external_id
        body: dict[str, Any] = {"prompt": {"text": text}}
        if images:
            body["prompt"]["images"] = [
                {"url": i["url"]} for i in images if isinstance(i, dict) and i.get("url")
            ]
        data = await request_json(
            "POST",
            f"{BASE}/agents/{agent_id}/runs",
            headers=self._headers(),
            json_body=body,
            auth=self._auth(creds),
        )
        if isinstance(data, dict) and data.get("id"):
            handle.external_ids["run_id"] = str(data["id"])

    async def cancel(self, handle: JobHandle, creds: dict[str, Any]) -> None:
        agent_id = handle.external_ids.get("agent_id") or handle.external_id
        run_id = handle.external_ids.get("run_id")
        if not run_id:
            # Fall back to archive when we have no active run id.
            await request_json(
                "POST",
                f"{BASE}/agents/{agent_id}/archive",
                headers=self._headers(),
                auth=self._auth(creds),
                retries=0,
            )
            return
        await request_json(
            "POST",
            f"{BASE}/agents/{agent_id}/runs/{run_id}/cancel",
            headers=self._headers(),
            auth=self._auth(creds),
            retries=0,
        )

    async def poll(self, handle: JobHandle, creds: dict[str, Any]) -> list[NormalizedEvent]:
        agent_id = handle.external_ids.get("agent_id") or handle.external_id
        run_id = handle.external_ids.get("run_id")
        agent = await request_json(
            "GET",
            f"{BASE}/agents/{agent_id}",
            headers=self._headers(),
            auth=self._auth(creds),
            retries=0,
        )
        assert isinstance(agent, dict)
        latest = str(agent.get("latestRunId") or run_id or "")
        if latest:
            handle.external_ids["run_id"] = latest
        if not latest:
            return []
        run = await request_json(
            "GET",
            f"{BASE}/agents/{agent_id}/runs/{latest}",
            headers=self._headers(),
            auth=self._auth(creds),
            retries=0,
        )
        assert isinstance(run, dict)
        return self._events_from_run(agent_id, run)

    def verify_webhook(self, headers: dict[str, str], raw_body: bytes, secret: str) -> bool:
        signature = headers.get("x-webhook-signature") or headers.get("X-Webhook-Signature") or ""
        if not secret or not signature:
            return False
        expected = "sha256=" + hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature)

    async def handle_webhook(self, payload: dict[str, Any]) -> list[NormalizedEvent]:
        status = str(payload.get("status") or "").upper()
        agent_id = str(payload.get("id") or "")
        kind = {
            "FINISHED": "finished",
            "ERROR": "failed",
            "CANCELLED": "cancelled",
            "EXPIRED": "failed",
            "RUNNING": "progress",
            "CREATING": "progress",
        }.get(status, "progress")
        target = payload.get("target") if isinstance(payload.get("target"), dict) else {}
        events = [
            NormalizedEvent(
                kind=kind if kind != "progress" else ("started" if status == "CREATING" else "progress"),
                summary=str(payload.get("summary") or status or "update"),
                external_event_id=f"cursor-webhook:{agent_id}:{status}:{payload.get('timestamp') or ''}",
                payload={
                    "provider_status": status,
                    "url": (target or {}).get("url") or f"https://cursor.com/agents?id={agent_id}",
                    "agent_id": agent_id,
                },
            )
        ]
        pr_url = (target or {}).get("prUrl")
        branch = (target or {}).get("branchName")
        if pr_url:
            events.append(
                NormalizedEvent(
                    kind="artifact",
                    summary=f"Pull request {pr_url}",
                    external_event_id=f"cursor-pr:{pr_url}",
                    payload={
                        "artifact": {
                            "type": "pr",
                            "url": pr_url,
                            "ref": branch or "",
                            "title": str(payload.get("summary") or "Pull request"),
                            "state": "open",
                            "external_id": pr_url,
                        }
                    },
                )
            )
        elif branch:
            events.append(
                NormalizedEvent(
                    kind="artifact",
                    summary=f"Branch {branch}",
                    external_event_id=f"cursor-branch:{agent_id}:{branch}",
                    payload={
                        "artifact": {
                            "type": "branch",
                            "ref": branch,
                            "url": "",
                            "title": branch,
                            "state": None,
                            "external_id": branch,
                        }
                    },
                )
            )
        return events

    def _events_from_run(self, agent_id: str, run: dict[str, Any]) -> list[NormalizedEvent]:
        status = str(run.get("status") or "").upper()
        mapped = _RUN_STATUS.get(status, "running")
        kind = {
            "queued": "progress",
            "running": "progress",
            "finished": "finished",
            "failed": "failed",
            "cancelled": "cancelled",
        }[mapped]
        events = [
            NormalizedEvent(
                kind=kind,
                summary=str(run.get("text") or run.get("summary") or status),
                external_event_id=f"cursor-run:{run.get('id') or ''}:{status}",
                payload={
                    "provider_status": status,
                    "run_id": str(run.get("id") or ""),
                    "agent_id": agent_id,
                    "duration_ms": run.get("durationMs"),
                },
            )
        ]
        git = run.get("git") if isinstance(run.get("git"), dict) else {}
        pr_url = git.get("prUrl") or git.get("pullRequestUrl")
        branch = git.get("branchName") or git.get("branch")
        if pr_url:
            events.append(
                NormalizedEvent(
                    kind="artifact",
                    summary=f"Pull request {pr_url}",
                    external_event_id=f"cursor-pr:{pr_url}",
                    payload={
                        "artifact": {
                            "type": "pr",
                            "url": pr_url,
                            "ref": branch or "",
                            "title": str(run.get("text") or "Pull request")[:200],
                            "state": "open",
                            "external_id": pr_url,
                        }
                    },
                )
            )
        return events


register_adapter("cursor", CursorWorkbenchAdapter)

# Keep a no-op import side-effect helper for tests that mint agent ids.
def make_agent_id(job_id: uuid.UUID | str) -> str:
    raw = str(job_id).replace("-", "")
    return f"bc-{raw[:8]}-{raw[8:12]}-{raw[12:16]}-{raw[16:20]}-{raw[20:32]}"
