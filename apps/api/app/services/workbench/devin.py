"""Devin API v3 workbench adapter.

Docs: https://docs.devin.ai/api-reference/v3/overview
Auth: Bearer cog_… service-user key + org_id in path.
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

BASE = "https://api.devin.ai/v3"


def _map_status(status: str, detail: str | None) -> str:
    status = (status or "").lower()
    detail = (detail or "").lower()
    if status in ("new", "claimed", "resuming"):
        return "queued" if status != "resuming" else "running"
    if status == "running":
        if detail in ("waiting_for_user", "waiting_for_approval"):
            return "needs_input"
        if detail == "finished":
            return "finished"
        return "running"
    if status == "exit":
        return "finished"
    if status == "error":
        return "failed"
    if status == "suspended":
        if detail == "user_request":
            return "cancelled"
        if detail in (
            "usage_limit_exceeded",
            "out_of_credits",
            "out_of_quota",
            "no_quota_allocation",
            "payment_declined",
            "org_usage_limit_exceeded",
            "user_usage_limit_exceeded",
            "total_session_limit_exceeded",
            "contract_expired",
            "error",
        ):
            return "failed"
        if detail == "inactivity":
            return "needs_input"
        return "failed"
    return "running"


class DevinWorkbenchAdapter:
    provider = "devin"
    category = "cloud"
    api_version = "v3"

    def capabilities(self) -> AdapterCapabilities:
        return AdapterCapabilities(
            start=True,
            follow_up=True,
            cancel=True,
            needs_input_native=True,
            mcp_attach_per_job=False,
            creates_pr=True,
            stream=False,
            webhook=False,
            budget_native=True,
            images=True,
            plan_mode=False,
            needs_repo=True,
            mcp_attach=False,
            needs_input_events=True,
            budget=True,
            user_attribution=True,
        )

    def _org(self, creds: dict[str, Any]) -> str:
        org = str(creds.get("org_id") or creds.get("organization_id") or "").strip()
        if not org:
            raise WorkbenchHttpError("Devin org_id missing on connection")
        return org

    def _headers(self, creds: dict[str, Any]) -> dict[str, str]:
        key = str(creds.get("api_key") or creds.get("token") or "").strip()
        if not key:
            raise WorkbenchHttpError("Devin API key missing on connection")
        return {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

    def _session_url(self, creds: dict[str, Any], session_id: str, suffix: str = "") -> str:
        org = self._org(creds)
        base = f"{BASE}/organizations/{org}/sessions/{session_id}"
        return f"{base}{suffix}"

    async def start(self, spec: JobSpec, creds: dict[str, Any]) -> JobHandle:
        org = self._org(creds)
        prompt = build_prompt(spec)
        if spec.repo_url:
            prompt = f"{prompt}\n\nPrimary repository: {spec.repo_url}@{spec.ref or 'main'}"
        if spec.mcp is None:
            # Devin MCP is org-level; give the job_ref so ask_question can route.
            job_ref = (spec.context_packet or {}).get("job_ref")
            if job_ref:
                prompt += (
                    f"\n\nWhen you need input from Bokito, call the bokito MCP tools "
                    f"with job_ref={job_ref}."
                )

        body: dict[str, Any] = {
            "prompt": prompt,
            "title": (spec.brief or "Bokito workbench job")[:120],
            "tags": ["bokito", "workbench"],
        }
        if spec.repo_url:
            body["repos"] = [spec.repo_url]
        if spec.budget and spec.budget.max_cost_cents:
            # Approximate: 1 ACU ≈ provider unit; store cents/100 as ACU ceiling.
            # Operators can set max_acu_limit explicitly via options.
            acu = spec.options.get("max_acu_limit")
            if acu is None:
                acu = max(1, int(spec.budget.max_cost_cents / 100))
            body["max_acu_limit"] = int(acu)
        elif spec.options.get("max_acu_limit") is not None:
            body["max_acu_limit"] = int(spec.options["max_acu_limit"])
        if spec.images:
            urls = [str(i["url"]) for i in spec.images if isinstance(i, dict) and i.get("url")]
            if urls:
                body["attachment_urls"] = urls
        if creds.get("create_as_user_id"):
            body["create_as_user_id"] = str(creds["create_as_user_id"])

        data = await request_json(
            "POST",
            f"{BASE}/organizations/{org}/sessions",
            headers=self._headers(creds),
            json_body=body,
        )
        assert isinstance(data, dict)
        session_id = str(data.get("session_id") or data.get("devin_id") or data.get("id") or "")
        if not session_id:
            raise WorkbenchHttpError("Devin create returned no session_id", body=data)
        return JobHandle(
            provider=self.provider,
            external_id=session_id,
            external_ids={
                "session_id": session_id,
                "org_id": org,
                "status": str(data.get("status") or "new"),
                "status_detail": str(data.get("status_detail") or ""),
                "url": str(data.get("url") or data.get("session_url") or ""),
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
        body: dict[str, Any] = {"message": text}
        if images:
            urls = [str(i["url"]) for i in images if isinstance(i, dict) and i.get("url")]
            if urls:
                body["attachment_urls"] = urls
        await request_json(
            "POST",
            self._session_url(creds, session_id, "/messages"),
            headers=self._headers(creds),
            json_body=body,
        )

    async def cancel(self, handle: JobHandle, creds: dict[str, Any]) -> None:
        session_id = handle.external_ids.get("session_id") or handle.external_id
        await request_json(
            "DELETE",
            self._session_url(creds, session_id) + "?archive=true",
            headers=self._headers(creds),
            retries=0,
        )

    async def poll(self, handle: JobHandle, creds: dict[str, Any]) -> list[NormalizedEvent]:
        session_id = handle.external_ids.get("session_id") or handle.external_id
        data = await request_json(
            "GET",
            self._session_url(creds, session_id),
            headers=self._headers(creds),
            retries=0,
        )
        assert isinstance(data, dict)
        status = str(data.get("status") or "")
        detail = str(data.get("status_detail") or "") or None
        mapped = _map_status(status, detail)
        kind = {
            "queued": "progress",
            "running": "progress",
            "needs_input": "needs_input",
            "finished": "finished",
            "failed": "failed",
            "cancelled": "cancelled",
        }[mapped]
        handle.external_ids["status"] = status
        handle.external_ids["status_detail"] = detail or ""
        events = [
            NormalizedEvent(
                kind=kind,
                summary=str(data.get("title") or detail or status),
                external_event_id=f"devin:{session_id}:{status}:{detail}:{data.get('updated_at')}",
                payload={
                    "provider_status": status,
                    "status_detail": detail,
                    "session_id": session_id,
                    "url": data.get("url") or handle.external_ids.get("url"),
                    "acus_consumed": data.get("acus_consumed"),
                },
            )
        ]
        prs = data.get("pull_requests") or data.get("pullRequests") or []
        if isinstance(prs, list):
            for pr in prs:
                if not isinstance(pr, dict):
                    continue
                url = str(pr.get("url") or pr.get("pr_url") or "")
                if not url:
                    continue
                events.append(
                    NormalizedEvent(
                        kind="artifact",
                        summary=f"Pull request {url}",
                        external_event_id=f"devin-pr:{url}",
                        payload={
                            "artifact": {
                                "type": "pr",
                                "url": url,
                                "ref": str(pr.get("branch") or ""),
                                "title": str(pr.get("title") or "Pull request"),
                                "state": str(pr.get("state") or "open"),
                                "external_id": url,
                            }
                        },
                    )
                )
        return events

    def verify_webhook(self, headers: dict[str, str], raw_body: bytes, secret: str) -> bool:
        return False

    async def handle_webhook(self, payload: dict[str, Any]) -> list[NormalizedEvent]:
        return []


register_adapter("devin", DevinWorkbenchAdapter)
