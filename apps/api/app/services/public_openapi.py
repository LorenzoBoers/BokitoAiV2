"""Curated public OpenAPI schema for the docs site API reference.

Filters the full FastAPI schema down to the developer-facing surface
(public REST v1, help-center, MCP transport) and enriches it with servers,
auth metadata and a top-level description. Served at
``GET /api/docs/openapi.json`` and rendered by Scalar on ``/docs/api``.
"""

from __future__ import annotations

import copy
import re
from typing import Any

from fastapi import FastAPI

from app.config import get_settings

PUBLIC_TAGS = {"public-api", "help-center", "mcp"}

_REF_RE = re.compile(r"#/components/schemas/([A-Za-z0-9_.-]+)")

_DESCRIPTION = """\
The Bokito public API. Authenticate every request with a workspace API token
(`bok_` prefix, created under Settings > Developers) sent as a bearer token:

    Authorization: Bearer bok_...

Surfaces:

- **public-api** — REST v1: read signals and messages, create inbound signals.
  Scopes: `signals:read`, `signals:write` (empty scope list = full access).
- **mcp** — the MCP endpoint (JSON-RPC 2.0 over POST) exposing governed
  workspace tools to external MCP clients.
- **help-center** — the public, per-tenant help center content API used by the
  chat widget and hosted help pages.

Outbound **webhooks** (signal.created, signal.closed, decision.created) are
documented in the Webhooks guide; deliveries are signed with
`X-Bokito-Signature: v1=HMAC_SHA256_hex(secret, "{timestamp}.{body}")`.

Rate limits are per client IP per minute and answer `429` with `Retry-After`.
"""


def _collect_refs(node: Any, found: set[str]) -> None:
    if isinstance(node, dict):
        ref = node.get("$ref")
        if isinstance(ref, str):
            match = _REF_RE.search(ref)
            if match:
                found.add(match.group(1))
        for value in node.values():
            _collect_refs(value, found)
    elif isinstance(node, list):
        for value in node:
            _collect_refs(value, found)


def build_public_openapi(app: FastAPI) -> dict[str, Any]:
    settings = get_settings()
    full = app.openapi()
    paths: dict[str, Any] = {}
    for path, operations in (full.get("paths") or {}).items():
        kept_ops = {}
        for method, op in operations.items():
            if not isinstance(op, dict):
                continue
            tags = set(op.get("tags") or [])
            if tags & PUBLIC_TAGS:
                kept_ops[method] = copy.deepcopy(op)
        if kept_ops:
            paths[path] = kept_ops

    # Keep only the component schemas the public operations actually reference
    # (including transitive refs between schemas).
    all_schemas = (full.get("components") or {}).get("schemas") or {}
    needed: set[str] = set()
    _collect_refs(paths, needed)
    resolved: dict[str, Any] = {}
    queue = sorted(needed)
    while queue:
        name = queue.pop()
        if name in resolved or name not in all_schemas:
            continue
        schema = copy.deepcopy(all_schemas[name])
        resolved[name] = schema
        nested: set[str] = set()
        _collect_refs(schema, nested)
        queue.extend(n for n in nested if n not in resolved)

    return {
        "openapi": full.get("openapi", "3.1.0"),
        "info": {
            "title": "Bokito Public API",
            "version": "1.0.0",
            "description": _DESCRIPTION,
        },
        "servers": [{"url": (settings.public_api_url or "").rstrip("/")}],
        "paths": paths,
        "components": {
            "schemas": resolved,
            "securitySchemes": {
                "apiToken": {
                    "type": "http",
                    "scheme": "bearer",
                    "description": "Workspace API token with the `bok_` prefix.",
                }
            },
        },
        "security": [{"apiToken": []}],
        "tags": [
            {"name": "public-api", "description": "REST v1: signals in and out of the inbox."},
            {"name": "mcp", "description": "MCP endpoint: governed workspace tools over JSON-RPC."},
            {"name": "help-center", "description": "Public per-tenant help center content."},
        ],
    }
