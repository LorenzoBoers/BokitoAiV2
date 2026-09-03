"""Remote MCP catalog integrity (shared JSON source of truth)."""

from __future__ import annotations

from app.services.integrations_catalog import PROVIDER_BY_SLUG, PROVIDERS
from app.services.mcp_remote_catalog import catalog_hosts, catalog_providers, load_mcp_remote_catalog


def test_catalog_json_loads_and_has_unique_slugs():
    data = load_mcp_remote_catalog()
    hosts = catalog_hosts()
    providers = catalog_providers()
    assert hosts and providers
    assert len({h["slug"] for h in hosts}) == len(hosts)
    assert len({p["slug"] for p in providers}) == len(providers)
    assert "version" not in data or isinstance(data.get("version"), (str, int))


def test_every_provider_points_at_a_host():
    host_slugs = {h["slug"] for h in catalog_hosts()}
    for row in catalog_providers():
        assert row["host_slug"] in host_slugs, row["slug"]


def test_available_oauth_presets_require_url():
    for row in catalog_providers():
        url = str(row.get("mcp_remote_url") or "").strip()
        status = str(row.get("status") or "coming_soon")
        auth = str(row.get("auth_type") or "")
        if status == "available" and auth == "mcp_remote_oauth":
            assert url.startswith("https://"), row["slug"]


def test_mollie_is_available_with_official_url():
    row = next(p for p in catalog_providers() if p["slug"] == "mollie_mcp")
    assert row["status"] == "available"
    assert row["mcp_remote_url"] == "https://mcp.mollie.com/mcp"
    assert PROVIDER_BY_SLUG["mollie_mcp"]["status"] == "available"


def test_shopify_stays_coming_soon_core_not_remote_duplicate():
    assert PROVIDER_BY_SLUG["shopify_mcp"]["status"] == "coming_soon"
    assert "shopify_mcp" not in {p["slug"] for p in catalog_providers()}


def test_no_us_accounting_presets():
    slugs = {p["slug"] for p in catalog_providers()}
    assert "quickbooks_mcp" not in slugs
    assert "xero_mcp" not in slugs


def test_providers_include_expanded_library():
    slugs = {p["slug"] for p in PROVIDERS}
    for expected in (
        "mollie_mcp",
        "stripe_mcp",
        "notion_mcp",
        "pipedrive_mcp",
        "woocommerce_mcp",
        "afas_mcp",
        "teamleader_mcp",
        "buckaroo_mcp",
    ):
        assert expected in slugs
