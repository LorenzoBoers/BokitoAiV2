"""Static integration provider catalog for the dashboard marketplace.

Provider ids are stable UUID5 values derived from slug so connection rows
can reference them via provider_id without a database seed table.
"""

import uuid
from typing import Any

from app.config import get_settings

NAMESPACE = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")


def provider_id(slug: str) -> str:
    return str(uuid.uuid5(NAMESPACE, f"bokito.provider.{slug}"))


def host_id(slug: str) -> str:
    return str(uuid.uuid5(NAMESPACE, f"bokito.host.{slug}"))


HOSTS: list[dict[str, Any]] = [
    {"id": host_id("github"), "slug": "github", "name": "GitHub", "brand_color": "#24292f", "initials": "GH"},
    {"id": host_id("microsoft"), "slug": "microsoft", "name": "Microsoft", "brand_color": "#0078d4", "initials": "MS"},
    {"id": host_id("google"), "slug": "google", "name": "Google", "brand_color": "#4285f4", "initials": "GO"},
    {"id": host_id("bjorn_lunden"), "slug": "bjorn_lunden", "name": "Bjorn Lunden", "brand_color": "#0f766e", "initials": "BL"},
    {"id": host_id("custom"), "slug": "custom", "name": "Custom MCP", "brand_color": "#475569", "initials": "MC"},
    {"id": host_id("notion"), "slug": "notion", "name": "Notion", "brand_color": "#000000", "initials": "NO"},
    {"id": host_id("linear"), "slug": "linear", "name": "Linear", "brand_color": "#5e6ad2", "initials": "LN"},
    {"id": host_id("atlassian"), "slug": "atlassian", "name": "Atlassian", "brand_color": "#0052cc", "initials": "AT"},
    {"id": host_id("slack"), "slug": "slack", "name": "Slack", "brand_color": "#4a154b", "initials": "SL"},
    {"id": host_id("asana"), "slug": "asana", "name": "Asana", "brand_color": "#f06a6a", "initials": "AS"},
    {"id": host_id("clickup"), "slug": "clickup", "name": "ClickUp", "brand_color": "#7b68ee", "initials": "CU"},
    {"id": host_id("sentry"), "slug": "sentry", "name": "Sentry", "brand_color": "#362d59", "initials": "SE"},
    {"id": host_id("stripe"), "slug": "stripe", "name": "Stripe", "brand_color": "#635bff", "initials": "ST"},
    {"id": host_id("shopify"), "slug": "shopify", "name": "Shopify", "brand_color": "#96bf48", "initials": "SH"},
    {"id": host_id("higgsfield"), "slug": "higgsfield", "name": "Higgsfield", "brand_color": "#111111", "initials": "HF"},
]

HOST_BY_SLUG = {h["slug"]: h for h in HOSTS}


def _provider(
    slug: str,
    name: str,
    description: str,
    category: str,
    auth_type: str,
    *,
    host_slug: str,
    capabilities: dict[str, bool] | None = None,
    status: str = "available",
    sort_order: int = 0,
    mcp_remote_url: str | None = None,
    mcp_transport: str | None = None,
) -> dict[str, Any]:
    host = HOST_BY_SLUG.get(host_slug, HOST_BY_SLUG["custom"])
    return {
        "id": provider_id(slug),
        "slug": slug,
        "name": name,
        "description": description,
        "category": category,
        "auth_type": auth_type,
        "capabilities": capabilities or {},
        "status": status,
        "host_id": host["id"],
        "host": host,
        "logo_meta": {"initials": host["initials"], "color": host["brand_color"]},
        "sort_order": sort_order,
        "mcp_remote_url": mcp_remote_url,
        "mcp_transport": mcp_transport,
        "oauth_profile": None,
    }


PROVIDERS: list[dict[str, Any]] = [
    _provider(
        "github",
        "GitHub",
        "Koppel GitHub-repositories voor code-indexering en agentworkflows.",
        "Ontwikkeling",
        "oauth2",
        host_slug="github",
        capabilities={"repository": True},
        sort_order=1,
    ),
    _provider(
        "outlook",
        "Microsoft 365 / Outlook",
        "Mailbox en agenda via Microsoft Graph.",
        "Communicatie",
        "oauth2",
        host_slug="microsoft",
        capabilities={"email": True, "calendar": True},
        sort_order=2,
    ),
    _provider(
        "gmail",
        "Google Workspace / Gmail",
        "Mailbox via Gmail API.",
        "Communicatie",
        "oauth2",
        host_slug="google",
        capabilities={"email": True},
        sort_order=3,
    ),
    _provider(
        "bjorn_lunden_mcp",
        "Bjorn Lunden MCP",
        "Accounting tools via the native Bjorn Lunden (BLA) API integration.",
        "Productiviteit",
        "api_key",
        host_slug="bjorn_lunden",
        capabilities={"mcp_tools": True},
        sort_order=10,
        # BJORN_LUNDEN_MCP_URL optionally points at an external MCP server;
        # unset means the built-in native BLA API integration is used.
        mcp_remote_url=get_settings().bjorn_lunden_mcp_url or None,
        mcp_transport="streamable_http",
    ),
    _provider(
        "custom_mcp",
        "Custom MCP",
        "Eigen MCP-server met API-key of bearer token.",
        "Productiviteit",
        "api_key",
        host_slug="custom",
        capabilities={"mcp_tools": True},
        sort_order=11,
    ),
    _provider(
        "shopify_mcp",
        "Shopify",
        "Shopify-winkel via MCP (OAuth).",
        "Productiviteit",
        "oauth2",
        host_slug="shopify",
        capabilities={"mcp_tools": True},
        sort_order=12,
    ),
    _provider(
        "notion_mcp",
        "Notion",
        "Notion-workspaces voor documenten en kennisbanken via MCP.",
        "Productiviteit",
        "mcp_remote_oauth",
        host_slug="notion",
        capabilities={"mcp_tools": True},
        status="coming_soon",
        sort_order=20,
        mcp_remote_url="https://mcp.notion.com/mcp",
        mcp_transport="streamable_http",
    ),
    _provider(
        "linear_mcp",
        "Linear",
        "Issues, projecten en comments uit Linear voor agents.",
        "Productiviteit",
        "mcp_remote_oauth",
        host_slug="linear",
        capabilities={"mcp_tools": True},
        status="coming_soon",
        sort_order=21,
        mcp_remote_url="https://mcp.linear.app/mcp",
        mcp_transport="streamable_http",
    ),
    _provider(
        "atlassian_mcp",
        "Atlassian Rovo",
        "Jira, Confluence en Compass via Atlassian MCP.",
        "Productiviteit",
        "mcp_remote_oauth",
        host_slug="atlassian",
        capabilities={"mcp_tools": True},
        status="coming_soon",
        sort_order=22,
        mcp_remote_url="https://mcp.atlassian.com/v1/mcp/authv2",
        mcp_transport="streamable_http",
    ),
    _provider(
        "slack_mcp",
        "Slack",
        "Zoeken, berichten en kanalen in Slack via MCP.",
        "Communicatie",
        "mcp_remote_oauth",
        host_slug="slack",
        capabilities={"mcp_tools": True},
        status="coming_soon",
        sort_order=23,
        mcp_remote_url="https://mcp.slack.com/mcp",
        mcp_transport="streamable_http",
    ),
    _provider(
        "asana_mcp",
        "Asana",
        "Taken en projecten in Asana via MCP.",
        "Productiviteit",
        "mcp_remote_oauth",
        host_slug="asana",
        capabilities={"mcp_tools": True},
        status="coming_soon",
        sort_order=24,
        mcp_remote_url="https://mcp.asana.com/v2/mcp",
        mcp_transport="streamable_http",
    ),
    _provider(
        "clickup_mcp",
        "ClickUp",
        "ClickUp-workspaces en taken voor agentworkflows.",
        "Productiviteit",
        "mcp_remote_oauth",
        host_slug="clickup",
        capabilities={"mcp_tools": True},
        status="coming_soon",
        sort_order=25,
        mcp_remote_url="https://mcp.clickup.com/mcp",
        mcp_transport="streamable_http",
    ),
    _provider(
        "sentry_mcp",
        "Sentry",
        "Issues, projecten en debugging-context uit Sentry.",
        "Ontwikkeling",
        "mcp_remote_oauth",
        host_slug="sentry",
        capabilities={"mcp_tools": True},
        status="coming_soon",
        sort_order=26,
        mcp_remote_url="https://mcp.sentry.dev/mcp",
        mcp_transport="streamable_http",
    ),
    _provider(
        "stripe_mcp",
        "Stripe",
        "Stripe-data en acties via hosted MCP.",
        "Productiviteit",
        "mcp_remote_oauth",
        host_slug="stripe",
        capabilities={"mcp_tools": True},
        status="coming_soon",
        sort_order=27,
        mcp_remote_url="https://mcp.stripe.com",
        mcp_transport="streamable_http",
    ),
    _provider(
        "github_mcp",
        "GitHub MCP",
        "GitHub issues en PRs via remote MCP.",
        "Ontwikkeling",
        "mcp_remote_oauth",
        host_slug="github",
        capabilities={"mcp_tools": True},
        status="coming_soon",
        sort_order=28,
        mcp_remote_url="https://api.githubcopilot.com/mcp/",
        mcp_transport="streamable_http",
    ),
    _provider(
        "microsoft_graph_mcp",
        "Microsoft Graph MCP",
        "Entra en directory-inzichten via Microsoft MCP Server.",
        "Communicatie",
        "mcp_remote_oauth",
        host_slug="microsoft",
        capabilities={"mcp_tools": True},
        status="coming_soon",
        sort_order=29,
        mcp_remote_url="https://mcp.svc.cloud.microsoft/enterprise",
        mcp_transport="streamable_http",
    ),
    _provider(
        "higgsfield_mcp",
        "Higgsfield",
        "AI-beeld- en videogeneratie via de hosted Higgsfield MCP-server.",
        "Productiviteit",
        "mcp_remote_oauth",
        host_slug="higgsfield",
        capabilities={"mcp_tools": True},
        status="coming_soon",
        sort_order=30,
        mcp_remote_url="https://mcp.higgsfield.ai/mcp",
        mcp_transport="streamable_http",
    ),
]

PROVIDER_BY_SLUG = {p["slug"]: p for p in PROVIDERS}
PROVIDER_BY_ID = {p["id"]: p for p in PROVIDERS}


def slug_for_provider_id(pid: str) -> str | None:
    row = PROVIDER_BY_ID.get(pid)
    return row["slug"] if row else None
