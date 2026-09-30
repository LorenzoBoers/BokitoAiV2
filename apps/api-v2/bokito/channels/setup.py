"""Connection lifecycle hooks and the provider catalog (code, not a table)."""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from bokito.config import get_settings
from bokito.domain.connection import Connection, ConnectionKind

CATALOG: dict[str, list[dict[str, Any]]] = {
    "email": [
        {
            "provider": "resend",
            "name": "Email (managed inbox)",
            "fields": [],
            "description": "A Bokito address that receives and sends mail through Resend.",
        }
    ],
    "whatsapp": [
        {
            "provider": "meta",
            "name": "WhatsApp Business (Meta Cloud API)",
            "fields": ["phone_number_id", "waba_id", "access_token"],
            "description": "Per-message costs are metered to usage.",
        }
    ],
    "widget": [
        {
            "provider": "bokito",
            "name": "Website chat widget",
            "fields": [],
            "description": "Embed one script tag.",
        }
    ],
    "phone": [
        {
            "provider": "stub",
            "name": "Phone (interface)",
            "fields": [],
            "description": "Voice notes and call summaries land as conversations.",
        }
    ],
    "model_provider": [
        {"provider": "mistral", "name": "Mistral (EU)", "fields": ["api_key"], "region": "eu"},
        {"provider": "openai", "name": "OpenAI", "fields": ["api_key"], "region": "us"},
        {"provider": "anthropic", "name": "Anthropic", "fields": ["api_key"], "region": "us"},
        {
            "provider": "azure-openai",
            "name": "Azure OpenAI (EU region)",
            "fields": ["api_key", "base_url"],
            "region": "eu",
        },
    ],
    "mcp": [
        {
            "provider": "remote",
            "name": "Remote MCP server",
            "fields": ["url", "token"],
            "description": "Streamable HTTP.",
        }
    ],
    "workbench": [
        {
            "provider": "cursor",
            "name": "Cursor cloud agents",
            "fields": ["api_key"],
            "description": "Hand coding work to Cursor.",
        },
        {
            "provider": "codex",
            "name": "OpenAI Codex",
            "fields": ["api_key"],
            "description": "Hand coding work to Codex.",
        },
    ],
    "integration": [
        {
            "provider": "moneybird",
            "name": "Moneybird",
            "fields": ["access_token", "administration_id"],
            "module": "accounting",
        }
    ],
}


def catalog() -> dict[str, Any]:
    return CATALOG


async def on_created(session: AsyncSession, conn: Connection) -> None:
    settings = get_settings()
    if conn.kind == ConnectionKind.email and not conn.address:
        conn.address = f"{conn.public_key.lower()}@{settings.inbound_domain}"
    await session.flush()


async def verify(session: AsyncSession, conn: Connection) -> tuple[bool, str]:
    """Best-effort credential check per kind. Network checks are skipped in mock mode."""
    from bokito.services.connections import credentials_of

    creds = credentials_of(conn)
    if conn.kind == ConnectionKind.model_provider:
        return (bool(creds.get("api_key")), "" if creds.get("api_key") else "api_key missing")
    if conn.kind == ConnectionKind.whatsapp:
        needed = ("phone_number_id", "access_token")
        missing = [k for k in needed if not creds.get(k)]
        return (not missing, "" if not missing else f"missing {', '.join(missing)}")
    if conn.kind == ConnectionKind.integration:
        return (
            bool(creds.get("access_token")),
            "" if creds.get("access_token") else "access_token missing",
        )
    if conn.kind == ConnectionKind.mcp:
        return (
            bool((conn.settings or {}).get("url") or creds.get("url")),
            "url missing" if not ((conn.settings or {}).get("url") or creds.get("url")) else "",
        )
    return True, ""
