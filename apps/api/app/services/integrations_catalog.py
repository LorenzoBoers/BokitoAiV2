"""Static integration provider catalog for the dashboard marketplace.

Provider ids are stable UUID5 values derived from slug so connection rows
can reference them via provider_id without a database seed table.
"""

import uuid
from typing import Any

from app.config import get_settings
from app.services.mcp_remote_catalog import catalog_hosts, catalog_providers
from app.services.partner_mcp import partner_mcp_url

NAMESPACE = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")


def provider_id(slug: str) -> str:
    return str(uuid.uuid5(NAMESPACE, f"bokito.provider.{slug}"))


def host_id(slug: str) -> str:
    return str(uuid.uuid5(NAMESPACE, f"bokito.host.{slug}"))


_CORE_HOSTS: list[dict[str, Any]] = [
    {"id": host_id("github"), "slug": "github", "name": "GitHub", "brand_color": "#24292f", "initials": "GH"},
    {"id": host_id("microsoft"), "slug": "microsoft", "name": "Microsoft", "brand_color": "#0078d4", "initials": "MS"},
    {"id": host_id("google"), "slug": "google", "name": "Google", "brand_color": "#4285f4", "initials": "GO"},
    {"id": host_id("bjorn_lunden"), "slug": "bjorn_lunden", "name": "Bjorn Lunden", "brand_color": "#0f766e", "initials": "BL"},
    {"id": host_id("alpaca"), "slug": "alpaca", "name": "Alpaca", "brand_color": "#FFD700", "initials": "AL"},
    {"id": host_id("king"), "slug": "king", "name": "KING Accountancy", "brand_color": "#0f766e", "initials": "KA"},
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
    {"id": host_id("whatsapp"), "slug": "whatsapp", "name": "WhatsApp", "brand_color": "#25d366", "initials": "WA"},
    {"id": host_id("moneybird"), "slug": "moneybird", "name": "Moneybird", "brand_color": "#0e5b99", "initials": "MB"},
    {"id": host_id("gocardless"), "slug": "gocardless", "name": "GoCardless", "brand_color": "#f1f252", "initials": "GC"},
    {"id": host_id("exact"), "slug": "exact", "name": "Exact Online", "brand_color": "#e2001a", "initials": "EX"},
    {"id": host_id("snelstart"), "slug": "snelstart", "name": "SnelStart", "brand_color": "#f39200", "initials": "SS"},
    {"id": host_id("tink"), "slug": "tink", "name": "Tink", "brand_color": "#161616", "initials": "TI"},
    {"id": host_id("yapily"), "slug": "yapily", "name": "Yapily", "brand_color": "#1b1f3b", "initials": "YA"},
    {"id": host_id("knab"), "slug": "knab", "name": "Knab", "brand_color": "#ffcd00", "initials": "KN"},
    {"id": host_id("twelve_data"), "slug": "twelve_data", "name": "Twelve Data", "brand_color": "#1a73e8", "initials": "TD"},
    {"id": host_id("bitvavo"), "slug": "bitvavo", "name": "Bitvavo", "brand_color": "#0051ff", "initials": "BV"},
    {"id": host_id("tradingview"), "slug": "tradingview", "name": "TradingView", "brand_color": "#131722", "initials": "TV"},
    {"id": host_id("google_drive"), "slug": "google_drive", "name": "Google Drive", "brand_color": "#1ea362", "initials": "GD"},
    {"id": host_id("onedrive"), "slug": "onedrive", "name": "OneDrive / SharePoint", "brand_color": "#0078d4", "initials": "OD"},
    {"id": host_id("dropbox"), "slug": "dropbox", "name": "Dropbox", "brand_color": "#0061ff", "initials": "DB"},
]


def _merge_catalog_hosts(core: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_slug = {h["slug"]: h for h in core}
    for row in catalog_hosts():
        slug = str(row["slug"])
        if slug in by_slug:
            continue
        by_slug[slug] = {
            "id": host_id(slug),
            "slug": slug,
            "name": str(row.get("name") or slug),
            "brand_color": str(row.get("brand_color") or "#475569"),
            "initials": str(row.get("initials") or slug[:2].upper()),
        }
    return list(by_slug.values())


HOSTS: list[dict[str, Any]] = _merge_catalog_hosts(_CORE_HOSTS)

HOST_BY_SLUG = {h["slug"]: h for h in HOSTS}


def _provider(
    slug: str,
    name: str,
    description: str,
    category: str,
    auth_type: str,
    *,
    host_slug: str,
    capabilities: dict[str, Any] | None = None,
    status: str = "available",
    sort_order: int = 0,
    mcp_remote_url: str | None = None,
    mcp_transport: str | None = None,
    module: str | None = None,
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
        "module": module,
    }


_CORE_PROVIDERS: list[dict[str, Any]] = [
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
        "Mailbox via Microsoft Graph.",
        "Communicatie",
        "oauth2",
        host_slug="microsoft",
        capabilities={"email": True},
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
        "google_calendar",
        "Google Calendar",
        "Sync events into Agenda. Agents can list and propose calendar blocks.",
        "Productiviteit",
        "oauth2",
        host_slug="google",
        capabilities={"calendar": True},
        sort_order=4,
    ),
    _provider(
        "outlook_calendar",
        "Outlook Calendar",
        "Sync Microsoft 365 calendar into Agenda. Agents can list and propose blocks.",
        "Productiviteit",
        "oauth2",
        host_slug="microsoft",
        capabilities={"calendar": True},
        sort_order=5,
    ),
    _provider(
        "whatsapp",
        "WhatsApp Business",
        "WhatsApp Business-berichten in de inbox via de Cloud API.",
        "Communicatie",
        "api_key",
        host_slug="whatsapp",
        capabilities={"inbox_sync": True},
        sort_order=4,
    ),
    _provider(
        "bjorn_lunden_mcp",
        "Bjorn Lunden",
        "Boekhouding via de Bjorn Lunden (BLA) API, aangestuurd door de Accounting-module.",
        "Boekhouding",
        "api_key",
        host_slug="bjorn_lunden",
        capabilities={"mcp_tools": True, "accounting": True},
        sort_order=10,
        # BJORN_LUNDEN_MCP_URL optionally points at an external MCP server;
        # unset means the built-in native BLA API integration is used.
        mcp_remote_url=get_settings().bjorn_lunden_mcp_url or None,
        mcp_transport="streamable_http",
        module="accounting",
    ),
    _provider(
        "alpaca_mcp",
        "Alpaca",
        "Paper and live stock, ETF, crypto, and options trading via the Alpaca Trading API.",
        "Investeren",
        # Primary self-serve path is Trading API keys. Alpaca Connect (oauth2)
        # is implemented end-to-end; enable in UI when ALPACA_OAUTH_CLIENT_* are set.
        "api_key",
        host_slug="alpaca",
        capabilities={
            "mcp_tools": True,
            "auth_modes": ["api_key", "oauth2"],
            "alpaca_connect": True,
        },
        sort_order=11,
        mcp_remote_url=None,
        mcp_transport="streamable_http",
    ),
    _provider(
        "king_accountancy",
        "KING Accountancy",
        "Read-only toegang tot KING Accountancy administraties via Cloudswitch, onder de Accounting-module.",
        "Boekhouding",
        "api_key",
        host_slug="king",
        capabilities={"mcp_tools": True, "accounting": True},
        sort_order=9,
        mcp_remote_url=partner_mcp_url("king"),
        mcp_transport="streamable_http",
        module="accounting",
    ),
    _provider(
        "moneybird",
        "Moneybird",
        "Contacten, verkoopfacturen, inkoopdocumenten en bankmutaties via de Moneybird API.",
        "Boekhouding",
        "oauth2",
        host_slug="moneybird",
        capabilities={"accounting": True},
        sort_order=8,
        module="accounting",
    ),
    _provider(
        "gocardless_bank",
        "GoCardless Bank Account Data",
        "Read-only PSD2-toegang tot bankrekeningen, saldi en transacties, onder de Banking-module.",
        "Bankieren",
        "api_key",
        host_slug="gocardless",
        capabilities={"banking": True},
        sort_order=11,
        module="banking",
    ),
    _provider(
        "exact_online",
        "Exact Online",
        "Volledige boekhouding via de Exact Online REST API (App Center-partnertraject).",
        "Boekhouding",
        "oauth2",
        host_slug="exact",
        capabilities={"accounting": True},
        status="coming_soon",
        sort_order=13,
        module="accounting",
    ),
    _provider(
        "snelstart",
        "SnelStart",
        "Relaties, facturen en grootboek via de SnelStart B2B API (certificering vereist).",
        "Boekhouding",
        "api_key",
        host_slug="snelstart",
        capabilities={"accounting": True},
        status="coming_soon",
        sort_order=14,
        module="accounting",
    ),
    _provider(
        "tink",
        "Tink",
        "Open-banking accounts, balances and transactions (planned for Banking).",
        "Bankieren",
        "oauth2",
        host_slug="tink",
        capabilities={"banking": True},
        status="coming_soon",
        sort_order=15,
        module="banking",
    ),
    _provider(
        "yapily",
        "Yapily",
        "PSD2 account data across European banks (planned for Banking).",
        "Bankieren",
        "oauth2",
        host_slug="yapily",
        capabilities={"banking": True},
        status="coming_soon",
        sort_order=16,
        module="banking",
    ),
    _provider(
        "knab",
        "Knab",
        "Knab business accounts for Dutch SMBs (planned for Banking).",
        "Bankieren",
        "oauth2",
        host_slug="knab",
        capabilities={"banking": True},
        status="coming_soon",
        sort_order=17,
        module="banking",
    ),
    _provider(
        "twelve_data",
        "Twelve Data",
        "Market quotes and time series for watchlists (planned for Investing).",
        "Beleggen",
        "api_key",
        host_slug="twelve_data",
        capabilities={"investing": True},
        status="coming_soon",
        sort_order=18,
        module="investing",
    ),
    _provider(
        "bitvavo",
        "Bitvavo",
        "Dutch crypto exchange balances and orders (planned for Investing).",
        "Beleggen",
        "api_key",
        host_slug="bitvavo",
        capabilities={"investing": True},
        status="coming_soon",
        sort_order=19,
        module="investing",
    ),
    _provider(
        "tradingview_alerts",
        "TradingView",
        "Webhook alerts land as Signals (planned for Investing).",
        "Beleggen",
        "api_key",
        host_slug="tradingview",
        capabilities={"investing": True},
        status="coming_soon",
        sort_order=20,
        module="investing",
    ),
    _provider(
        "google_drive",
        "Google Drive",
        "Search and read Drive files into Knowledge (planned for Documents).",
        "Documenten",
        "oauth2",
        host_slug="google_drive",
        capabilities={"documents": True},
        status="coming_soon",
        sort_order=21,
        module="documents",
    ),
    _provider(
        "microsoft_graph_files",
        "OneDrive / SharePoint",
        "Search and read Microsoft 365 files into Knowledge (planned for Documents).",
        "Documenten",
        "oauth2",
        host_slug="onedrive",
        capabilities={"documents": True},
        status="coming_soon",
        sort_order=22,
        module="documents",
    ),
    _provider(
        "dropbox",
        "Dropbox",
        "Search and read Dropbox files into Knowledge (planned for Documents).",
        "Documenten",
        "oauth2",
        host_slug="dropbox",
        capabilities={"documents": True},
        status="coming_soon",
        sort_order=23,
        module="documents",
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
        "Shopify-winkel via MCP (per store; storefront URL is not a single OAuth preset).",
        "Productiviteit",
        "oauth2",
        host_slug="shopify",
        capabilities={"mcp_tools": True},
        status="coming_soon",
        sort_order=12,
    ),
]


CORE_PROVIDER_SLUGS: set[str] = {str(p["slug"]) for p in _CORE_PROVIDERS}


def remote_row_to_provider(
    row: dict[str, Any],
    *,
    host: Any | None = None,
    index: int = 0,
) -> dict[str, Any]:
    """Build a marketplace provider dict from a DB (or seed) remote row."""
    slug = str(row.get("slug") or "")
    url = str(row.get("mcp_remote_url") or "").strip() or None
    auth = str(row.get("auth_type") or "mcp_remote_oauth")
    caps: dict[str, bool] = {"mcp_tools": True}
    module = row.get("module")
    if module == "accounting":
        caps["accounting"] = True
    if module == "banking":
        caps["banking"] = True
    if module == "investing":
        caps["investing"] = True
    if module == "documents":
        caps["documents"] = True
    status = str(row.get("status") or "coming_soon")
    if auth == "mcp_remote_oauth" and not url:
        status = "coming_soon"
    host_slug = str(row.get("host_slug") or "custom")
    if host is not None:
        # Ensure HOST_BY_SLUG knows this host for logo_meta.
        slug_key = getattr(host, "slug", None) or host_slug
        if slug_key not in HOST_BY_SLUG:
            HOST_BY_SLUG[slug_key] = {
                "id": host_id(slug_key),
                "slug": slug_key,
                "name": getattr(host, "name", None) or slug_key,
                "brand_color": getattr(host, "brand_color", None) or "#475569",
                "initials": getattr(host, "initials", None) or slug_key[:2].upper(),
            }
            HOSTS.append(HOST_BY_SLUG[slug_key])
        host_slug = slug_key
    sort = row.get("sort_order")
    return _provider(
        slug,
        str(row.get("name") or slug),
        str(row.get("description") or ""),
        str(row.get("category_nl") or row.get("category") or "Productiviteit"),
        auth,
        host_slug=host_slug,
        capabilities=caps,
        status=status,
        sort_order=int(sort) if sort is not None else 20 + index,
        mcp_remote_url=url,
        mcp_transport=str(row.get("mcp_transport") or "streamable_http") if url else None,
        module=str(module) if module else None,
    )


def _remote_mcp_providers_from_json() -> list[dict[str, Any]]:
    """Cold-start remotes from JSON until the DB cache is loaded."""
    return [
        remote_row_to_provider(row, index=index)
        for index, row in enumerate(catalog_providers())
    ]


def rebuild_provider_index(
    remote_providers: list[dict[str, Any]],
    remote_hosts: list[dict[str, Any]] | None = None,
) -> None:
    """Replace the remote slice of PROVIDERS / PROVIDER_BY_SLUG (cores win)."""
    global PROVIDERS, PROVIDER_BY_SLUG, PROVIDER_BY_ID
    if remote_hosts:
        for h in remote_hosts:
            slug = str(h.get("slug") or "")
            if not slug:
                continue
            meta = {
                "id": host_id(slug),
                "slug": slug,
                "name": str(h.get("name") or slug),
                "brand_color": str(h.get("brand_color") or "#475569"),
                "initials": str(h.get("initials") or slug[:2].upper()),
            }
            if slug in HOST_BY_SLUG:
                HOST_BY_SLUG[slug].update(meta)
            else:
                HOST_BY_SLUG[slug] = meta
                HOSTS.append(meta)
    # Drop remotes that collide with core slugs.
    remotes = [p for p in remote_providers if p.get("slug") not in CORE_PROVIDER_SLUGS]
    PROVIDERS = [*_CORE_PROVIDERS, *remotes]
    PROVIDER_BY_SLUG.clear()
    PROVIDER_BY_SLUG.update({p["slug"]: p for p in PROVIDERS})
    PROVIDER_BY_ID.clear()
    PROVIDER_BY_ID.update({p["id"]: p for p in PROVIDERS})


# Mutable catalogs — refreshed from DB via integration_catalog_store.
PROVIDERS: list[dict[str, Any]] = []
PROVIDER_BY_SLUG: dict[str, Any] = {}
PROVIDER_BY_ID: dict[str, Any] = {}
rebuild_provider_index(_remote_mcp_providers_from_json())


def slug_for_provider_id(pid: str) -> str | None:
    row = PROVIDER_BY_ID.get(pid)
    return row["slug"] if row else None


def canonical_provider_slug(raw: str | None) -> str:
    """Map a stored provider column (slug or catalog UUID) to the catalog slug."""
    value = (raw or "").strip()
    if not value:
        return ""
    if value in PROVIDER_BY_SLUG:
        return value
    return slug_for_provider_id(value) or value
