"""Capability matrix for workbench providers (agent prompt + UI)."""

from __future__ import annotations

from typing import Any

from app.services.workbench import AdapterCapabilities, get_adapter

# Static matrix mirrors docs/architecture/workbench-gateway.md section 3.
CAPABILITIES: dict[str, dict[str, bool]] = {
    "cursor": {
        "start": True,
        "follow_up": True,
        "cancel": True,
        "needs_input_native": False,
        "mcp_attach_per_job": True,
        "creates_pr": True,
        "stream": True,
        "webhook": True,
        "budget_native": False,
        "images": True,
        "plan_mode": True,
    },
    "claude_managed": {
        "start": True,
        "follow_up": True,
        "cancel": True,
        "needs_input_native": True,
        "mcp_attach_per_job": True,
        "creates_pr": True,
        "stream": True,
        "webhook": False,
        "budget_native": True,
        "images": True,
        "plan_mode": False,
    },
    "devin": {
        "start": True,
        "follow_up": True,
        "cancel": True,
        "needs_input_native": True,
        "mcp_attach_per_job": False,
        "creates_pr": True,
        "stream": False,
        "webhook": False,
        "budget_native": True,
        "images": True,
        "plan_mode": False,
    },
    "github_copilot": {
        "start": True,
        "follow_up": True,
        "cancel": False,
        "needs_input_native": True,
        "mcp_attach_per_job": False,
        "creates_pr": True,
        "stream": False,
        "webhook": True,
        "budget_native": False,
        "images": False,
        "plan_mode": False,
    },
}

PHASE1_PROVIDERS = ("cursor", "claude_managed", "devin")

PROVIDER_LABELS = {
    "cursor": "Cursor Cloud Agents",
    "claude_managed": "Claude Managed Agents",
    "devin": "Devin",
    "github_copilot": "GitHub Copilot cloud agent",
}


def capability(provider: str, key: str) -> bool:
    row = CAPABILITIES.get(provider) or {}
    return bool(row.get(key))


def matrix_rows() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for provider, caps in CAPABILITIES.items():
        adapter = get_adapter(provider)
        live = adapter is not None and provider in PHASE1_PROVIDERS
        rows.append(
            {
                "provider": provider,
                "label": PROVIDER_LABELS.get(provider, provider),
                "phase": 1 if provider in PHASE1_PROVIDERS else 2,
                "connectable": live,
                "capabilities": caps,
                "api_version": getattr(adapter, "api_version", "") if adapter else "",
            }
        )
    return rows


def capabilities_for(provider: str) -> AdapterCapabilities:
    adapter = get_adapter(provider)
    if adapter is not None:
        return adapter.capabilities()
    row = CAPABILITIES.get(provider) or {}
    return AdapterCapabilities(**{k: bool(v) for k, v in row.items() if hasattr(AdapterCapabilities, k)})
