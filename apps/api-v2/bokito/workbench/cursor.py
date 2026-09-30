"""Cursor cloud agents adapter (https://cursor.com/docs/cloud-agent/api).

Endpoints used:
- GET  /v0/me                      verify the API key
- POST /v0/agents                  launch (prompt, source, target, webhook)
- GET  /v0/agents/{id}             status
- POST /v0/agents/{id}/followup    follow-up instructions

Webhooks: `statusChange` on FINISHED or ERROR, signed with HMAC-SHA256 over
the raw body in `X-Webhook-Signature: sha256=<hex>`.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from typing import Any

import httpx

from bokito.config import get_settings
from bokito.workbench import JobEvent, JobHandle, JobSpec, WorkbenchError, register_adapter

STATUS_MAP = {
    "CREATING": "queued",
    "PENDING": "queued",
    "RUNNING": "running",
    "FINISHED": "finished",
    "ERROR": "failed",
    "EXPIRED": "failed",
    "STOPPED": "cancelled",
}


def _handle(raw: dict[str, Any]) -> JobHandle:
    target = raw.get("target") or {}
    return JobHandle(
        provider="cursor",
        external_id=str(raw.get("id") or ""),
        status=STATUS_MAP.get(str(raw.get("status") or "").upper(), "running"),
        url=str(target.get("url") or ""),
        branch_name=str(target.get("branchName") or ""),
        pr_url=str(target.get("prUrl") or ""),
        raw=raw,
    )


class CursorAdapter:
    provider = "cursor"

    def _client(self, credentials: dict[str, Any]) -> httpx.AsyncClient:
        key = str(credentials.get("api_key") or "")
        if not key:
            raise WorkbenchError("Cursor api_key missing", code="workbench_credentials")
        return httpx.AsyncClient(
            base_url=get_settings().cursor_api_base,
            auth=(key, ""),
            timeout=httpx.Timeout(30.0, connect=10.0),
            headers={"User-Agent": "bokito-v2"},
        )

    @staticmethod
    def _live() -> bool:
        return get_settings().workbench_live

    @staticmethod
    async def _json(resp: httpx.Response) -> dict[str, Any]:
        if resp.status_code >= 400:
            detail = resp.text[:300]
            raise WorkbenchError(
                f"Cursor API {resp.status_code}: {detail}", code="workbench_upstream"
            )
        data = resp.json()
        return data if isinstance(data, dict) else {"data": data}

    async def verify(self, credentials: dict[str, Any]) -> tuple[bool, str]:
        if not credentials.get("api_key"):
            return False, "api_key missing"
        if not self._live():
            return True, ""
        try:
            async with self._client(credentials) as c:
                me = await self._json(await c.get("/v0/me"))
        except (httpx.HTTPError, WorkbenchError) as exc:
            return False, str(exc)[:300]
        return (
            True,
            f"Cursor key {me.get('apiKeyName') or ''} ({me.get('userEmail') or ''})".strip(),
        )

    async def launch(self, credentials: dict[str, Any], spec: JobSpec) -> JobHandle:
        body: dict[str, Any] = {
            "prompt": {"text": spec.brief},
            "source": {"repository": spec.repository},
            "target": {"autoCreatePr": spec.auto_pr},
        }
        if spec.ref:
            body["source"]["ref"] = spec.ref
        if spec.branch_name:
            body["target"]["branchName"] = spec.branch_name
        if spec.model:
            body["model"] = spec.model
        if spec.webhook_url:
            body["webhook"] = {"url": spec.webhook_url}
            if spec.webhook_secret:
                body["webhook"]["secret"] = spec.webhook_secret
        if not self._live():
            ext = "bc_mock_" + secrets.token_hex(6)
            return _handle(
                {
                    "id": ext,
                    "name": spec.brief[:60],
                    "status": "CREATING",
                    "source": body["source"],
                    "target": {
                        "url": f"https://cursor.com/agents?id={ext}",
                        "branchName": spec.branch_name or f"cursor/{ext[-6:]}",
                        "autoCreatePr": spec.auto_pr,
                    },
                    "mock": True,
                }
            )
        try:
            async with self._client(credentials) as c:
                raw = await self._json(await c.post("/v0/agents", json=body))
        except httpx.HTTPError as exc:
            raise WorkbenchError(
                f"Cursor API unreachable: {exc}", code="workbench_upstream"
            ) from exc
        return _handle(raw)

    async def status(self, credentials: dict[str, Any], external_id: str) -> JobHandle:
        if not self._live():
            return _handle(
                {
                    "id": external_id,
                    "status": "RUNNING",
                    "target": {"url": f"https://cursor.com/agents?id={external_id}"},
                    "mock": True,
                }
            )
        try:
            async with self._client(credentials) as c:
                raw = await self._json(await c.get(f"/v0/agents/{external_id}"))
        except httpx.HTTPError as exc:
            raise WorkbenchError(
                f"Cursor API unreachable: {exc}", code="workbench_upstream"
            ) from exc
        return _handle(raw)

    async def followup(self, credentials: dict[str, Any], external_id: str, text: str) -> JobHandle:
        if not self._live():
            return _handle({"id": external_id, "status": "RUNNING", "mock": True})
        try:
            async with self._client(credentials) as c:
                raw = await self._json(
                    await c.post(
                        f"/v0/agents/{external_id}/followup", json={"prompt": {"text": text}}
                    )
                )
        except httpx.HTTPError as exc:
            raise WorkbenchError(
                f"Cursor API unreachable: {exc}", code="workbench_upstream"
            ) from exc
        raw.setdefault("id", external_id)
        raw.setdefault("status", "RUNNING")
        return _handle(raw)

    def verify_webhook(self, secret: str, raw_body: bytes, signature: str) -> bool:
        if not secret or not signature.startswith("sha256="):
            return False
        expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, signature[len("sha256=") :].strip())

    def parse_webhook(self, payload: dict[str, Any]) -> JobEvent:
        handle = _handle(payload)
        kind = {"finished": "finished", "failed": "failed"}.get(handle.status, "progress")
        return JobEvent(
            provider="cursor",
            external_id=handle.external_id,
            kind=kind,
            summary=str(payload.get("summary") or ""),
            url=handle.url,
            branch_name=handle.branch_name,
            pr_url=handle.pr_url,
            raw=payload,
        )


register_adapter(CursorAdapter())
