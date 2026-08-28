"""Module registry: which integration modules exist and what they offer.

A module is a first-class contract (schema, verbs, skill, setup playbook).
Connectors are the packages underneath. Agents choose a module, not a vendor,
unless the tenant has more than one package connected.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

MODULE_SKILL_DIR = Path(__file__).resolve().parent.parent / "data" / "module_skills"

ModuleStatus = Literal["available", "coming_soon"]
TenantModuleStatus = Literal["off", "on", "connected", "coming_soon"]
MODULE_SETTINGS_KEY = "modules"
MODULE_TOOL_PREFIXES: dict[str, str] = {
    "accounting": "accounting_",
    "banking": "banking_",
    "investing": "investing_",
    "documents": "documents_",
}

SETUP_PATH_PREFIX = "/settings/modules"


@dataclass(frozen=True)
class ModuleSpec:
    slug: str
    name: str
    description: str
    status: ModuleStatus
    provider_slugs: tuple[str, ...]
    planned_provider_slugs: tuple[str, ...]
    verbs: tuple[str, ...]
    propose_verbs: tuple[str, ...]
    verb_labels: tuple[str, ...]
    needs_when: str
    setup_steps: tuple[str, ...]
    capability_summary: str

    @property
    def setup_path(self) -> str:
        return f"{SETUP_PATH_PREFIX}/{self.slug}"

    def tenant_status(self, *, connected: bool, enabled: bool = False) -> TenantModuleStatus:
        if self.status == "coming_soon":
            return "coming_soon"
        if not enabled:
            return "off"
        return "connected" if connected else "on"

    def serialize(self, *, connected: bool = False, enabled: bool = False) -> dict[str, Any]:
        live = connected if self.status == "available" else False
        return {
            "slug": self.slug,
            "name": self.name,
            "description": self.description,
            "status": self.status,
            "provider_slugs": list(self.provider_slugs),
            "planned_provider_slugs": list(self.planned_provider_slugs),
            "verbs": list(self.verbs),
            "propose_verbs": list(self.propose_verbs),
            "verb_labels": list(self.verb_labels),
            "needs_when": self.needs_when,
            "setup_steps": list(self.setup_steps),
            "capability_summary": self.capability_summary,
            "setup_path": self.setup_path,
            "enabled": enabled,
            "connected": live,
            "tenant_status": self.tenant_status(connected=live, enabled=enabled),
        }


MODULES: list[ModuleSpec] = [
    ModuleSpec(
        slug="accounting",
        name="Accounting",
        description=(
            "One accounting contract for agents: companies, parties, invoices, "
            "ledger, and outstanding balances across every connected package."
        ),
        status="available",
        provider_slugs=("king_accountancy", "bjorn_lunden_mcp", "moneybird"),
        planned_provider_slugs=("exact_online", "snelstart"),
        verbs=(
            "list_companies",
            "get_company",
            "search_parties",
            "get_party",
            "list_documents",
            "get_document",
            "list_accounts",
            "get_account",
            "list_ledger",
            "list_outstanding",
            "list_bank_mutations",
            "summarize",
        ),
        propose_verbs=(
            "propose_document",
            "propose_party",
            "propose_booking",
            "propose_match",
            "propose_send",
        ),
        verb_labels=(
            "Administrations",
            "Contacts",
            "Invoices and bills",
            "Chart of accounts",
            "Ledger",
            "Outstanding balances",
            "Bank mutations",
            "Summary",
        ),
        needs_when="invoices, VAT, ledgers, outstanding balances, or bookkeeping",
        setup_steps=(
            "Turn Accounting on under Settings > Modules.",
            "Choose a package (KING, Bjorn Lunden, or Moneybird).",
            "Connect with OAuth or an API key.",
            "If more than one administration appears, pick which one agents should use.",
        ),
        capability_summary=(
            "Agents can list administrations, contacts, invoices, ledger lines, "
            "and outstanding balances. Writes always become a decision you approve."
        ),
    ),
    ModuleSpec(
        slug="banking",
        name="Banking",
        description=(
            "PSD2 / open-banking reads (accounts, balances, transactions); "
            "payments only as a proposal that a human approves."
        ),
        status="coming_soon",
        provider_slugs=(),
        planned_provider_slugs=("gocardless_bank", "tink", "yapily", "knab"),
        verbs=("banking_list_accounts", "banking_get_balance", "banking_list_transactions"),
        propose_verbs=("propose_payment",),
        verb_labels=("Accounts", "Balances", "Transactions"),
        needs_when="bank balances, transactions, or outgoing payments",
        setup_steps=(
            "This module is prepared but not connectable yet.",
            "When a bank connector ships, you will pick it here and approve payments as decisions.",
        ),
        capability_summary=(
            "Later: read accounts, balances, and transactions. Payments stay a human-approved proposal."
        ),
    ),
    ModuleSpec(
        slug="investing",
        name="Investing",
        description=(
            "Market data, positions, and watchlists; TradingView webhook alerts "
            "land as Signals. Orders only as a proposal that a human approves."
        ),
        status="coming_soon",
        provider_slugs=(),
        planned_provider_slugs=("twelve_data", "alpaca", "bitvavo", "tradingview_alerts"),
        verbs=("investing_get_positions", "investing_get_quotes", "investing_list_watchlist"),
        propose_verbs=("propose_order",),
        verb_labels=("Positions", "Quotes", "Watchlists"),
        needs_when="positions, quotes, watchlists, or trade orders",
        setup_steps=(
            "This module is prepared but not connectable yet.",
            "When a broker or market-data connector ships, orders will land as decisions.",
        ),
        capability_summary=(
            "Later: positions, quotes, and watchlists. Orders stay a human-approved proposal."
        ),
    ),
    ModuleSpec(
        slug="documents",
        name="Documents",
        description=(
            "Bridge to external document storage. Read content flows into the "
            "existing workspace knowledge stack; uploads only as a proposal."
        ),
        status="coming_soon",
        provider_slugs=(),
        planned_provider_slugs=("google_drive", "microsoft_graph_files", "dropbox"),
        verbs=("documents_search", "documents_list", "documents_get_content"),
        propose_verbs=("propose_upload",),
        verb_labels=("Search files", "List files", "Read content"),
        needs_when="files that live in Drive, SharePoint, or Dropbox",
        setup_steps=(
            "This module is prepared but not connectable yet.",
            "When a storage connector ships, reads feed Knowledge and uploads stay decisions.",
        ),
        capability_summary=(
            "Later: search and read external files into Knowledge. Uploads stay a human-approved proposal."
        ),
    ),
]

MODULE_BY_SLUG: dict[str, ModuleSpec] = {m.slug: m for m in MODULES}

PROVIDER_MODULE: dict[str, str] = {
    slug: module.slug for module in MODULES for slug in module.provider_slugs
}
for module in MODULES:
    for slug in module.planned_provider_slugs:
        PROVIDER_MODULE.setdefault(slug, module.slug)

HEARTBEAT_MODULE_LINE = (
    "- If company.md or open threads mention invoices, VAT, or outstanding balances "
    "and accounting is off, use recommend_module so the operator can turn it on; "
    "otherwise HEARTBEAT_OK"
)


def module_for_provider(provider_slug: str) -> str | None:
    return PROVIDER_MODULE.get(provider_slug)


def get_module(slug: str) -> ModuleSpec | None:
    return MODULE_BY_SLUG.get(slug)


def parse_module_flags(settings: dict[str, Any] | None) -> dict[str, bool]:
    """Read Tenant.settings_json.modules into {slug: enabled}."""
    raw = (settings or {}).get(MODULE_SETTINGS_KEY)
    if not isinstance(raw, dict):
        return {}
    flags: dict[str, bool] = {}
    for slug, row in raw.items():
        if isinstance(row, bool):
            flags[str(slug)] = row
        elif isinstance(row, dict) and "enabled" in row:
            flags[str(slug)] = bool(row["enabled"])
    return flags


def module_is_enabled(
    spec: ModuleSpec, *, connected: bool, flags: dict[str, bool]
) -> bool:
    """Explicit flag wins; a live connector keeps a module on for existing tenants."""
    if spec.slug in flags:
        return flags[spec.slug]
    return connected


def serialize_modules(
    *,
    connected_slugs: set[str] | None = None,
    enabled_slugs: set[str] | None = None,
) -> list[dict[str, Any]]:
    """Public module rows for the marketplace API and agent tools."""
    connected = connected_slugs or set()
    enabled = enabled_slugs if enabled_slugs is not None else set()
    return [
        m.serialize(connected=m.slug in connected, enabled=m.slug in enabled)
        for m in MODULES
    ]


def filter_tools_for_modules(
    tools: list[dict[str, Any]], enabled_slugs: set[str]
) -> list[dict[str, Any]]:
    """Hide module verb tools until the operator turns that module on."""
    blocked = [
        prefix
        for slug, prefix in MODULE_TOOL_PREFIXES.items()
        if slug not in enabled_slugs
    ]
    if not blocked:
        return tools
    return [
        tool
        for tool in tools
        if not any(str(tool.get("name") or "").startswith(prefix) for prefix in blocked)
    ]


async def active_module_connections(
    session: AsyncSession, tenant_id: UUID, module_slug: str
) -> list[Any]:
    """Active IntegrationConnection rows that belong to one module."""
    from app.models.integration import IntegrationConnection

    spec = MODULE_BY_SLUG.get(module_slug)
    provider_slugs = list(spec.provider_slugs) if spec else []
    if not provider_slugs:
        return []
    result = await session.execute(
        select(IntegrationConnection).where(
            IntegrationConnection.tenant_id == tenant_id,
            IntegrationConnection.provider.in_(provider_slugs),
            IntegrationConnection.status == "active",
        )
    )
    return list(result.scalars().all())


async def connected_module_slugs(session: AsyncSession, tenant_id: UUID) -> set[str]:
    slugs: set[str] = set()
    for module in MODULES:
        if module.status != "available":
            continue
        if await active_module_connections(session, tenant_id, module.slug):
            slugs.add(module.slug)
    return slugs


async def _tenant_settings(session: AsyncSession, tenant_id: UUID) -> dict[str, Any]:
    from app.models.auth import Tenant

    tenant = await session.get(Tenant, tenant_id)
    if tenant is None:
        return {}
    try:
        data = json.loads(tenant.settings_json or "{}")
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


async def tenant_module_flags(session: AsyncSession, tenant_id: UUID) -> dict[str, bool]:
    return parse_module_flags(await _tenant_settings(session, tenant_id))


async def tenant_module_sets(
    session: AsyncSession, tenant_id: UUID
) -> tuple[set[str], set[str]]:
    """Return (enabled_slugs, connected_slugs) for a tenant."""
    connected = await connected_module_slugs(session, tenant_id)
    flags = await tenant_module_flags(session, tenant_id)
    enabled = {
        module.slug
        for module in MODULES
        if module_is_enabled(module, connected=module.slug in connected, flags=flags)
    }
    return enabled, connected


async def enabled_module_slugs(session: AsyncSession, tenant_id: UUID) -> set[str]:
    enabled, _ = await tenant_module_sets(session, tenant_id)
    return enabled


async def module_is_on(session: AsyncSession, tenant_id: UUID, slug: str) -> bool:
    enabled, _ = await tenant_module_sets(session, tenant_id)
    return slug in enabled


async def serialize_modules_for_tenant(
    session: AsyncSession, tenant_id: UUID
) -> list[dict[str, Any]]:
    enabled, connected = await tenant_module_sets(session, tenant_id)
    return serialize_modules(connected_slugs=connected, enabled_slugs=enabled)


async def set_module_enabled(
    session: AsyncSession,
    tenant_id: UUID,
    slug: str,
    enabled: bool,
    *,
    actor_id: Any = None,
) -> dict[str, Any]:
    """Persist an operator on/off switch. Does not revoke connections."""
    spec = MODULE_BY_SLUG.get(slug)
    if spec is None:
        raise ValueError(f"Unknown module '{slug}'")
    from app.models.auth import Tenant
    from app.services.audit import record_audit

    tenant = await session.get(Tenant, tenant_id)
    if tenant is None:
        raise ValueError("Tenant not found")
    settings = await _tenant_settings(session, tenant_id)
    raw = settings.get(MODULE_SETTINGS_KEY)
    modules = dict(raw) if isinstance(raw, dict) else {}
    current = modules.get(slug)
    row = dict(current) if isinstance(current, dict) else {}
    row["enabled"] = bool(enabled)
    modules[slug] = row
    settings[MODULE_SETTINGS_KEY] = modules
    tenant.settings_json = json.dumps(settings)
    session.add(tenant)
    await session.commit()
    await record_audit(
        session,
        tenant_id,
        action="module:enabled" if enabled else "module:disabled",
        actor_type="user" if actor_id else "system",
        actor_id=str(actor_id) if actor_id else "",
        resource_type="module",
        resource_id=slug,
        summary=f"{spec.name} {'on' if enabled else 'off'}",
        after={"slug": slug, "enabled": bool(enabled)},
    )
    rows = {m["slug"]: m for m in await serialize_modules_for_tenant(session, tenant_id)}
    return rows[slug]


async def enable_module_for_provider(
    session: AsyncSession, tenant_id: UUID, provider_slug: str
) -> None:
    """Turn the parent module on when a package is connected."""
    slug = module_for_provider(provider_slug)
    if not slug:
        return
    flags = await tenant_module_flags(session, tenant_id)
    if flags.get(slug) is True:
        return
    await set_module_enabled(session, tenant_id, slug, True)


def module_skill_text(module_slug: str) -> str:
    """Skill pack markdown for one module ('' when the file is missing)."""
    path = MODULE_SKILL_DIR / f"{module_slug}.md"
    try:
        return path.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def module_setup_playbook(module: ModuleSpec) -> str:
    """Short setup instructions for an available module that is not connected yet."""
    steps = "\n".join(f"{i}. {step}" for i, step in enumerate(module.setup_steps, start=1))
    return (
        f"## {module.name} module (on, no package)\n"
        f"Use when: {module.needs_when}.\n"
        f"Setup: {module.setup_path}\n"
        f"If this work comes up, call recommend_module with slug `{module.slug}` "
        f"instead of guessing a vendor.\n"
        f"{steps}"
    )


def with_heartbeat_module_hint(content: str) -> str:
    """Append the module wake line when a tenant heartbeat predates this rule."""
    if "recommend_module" in content:
        return content
    return content.rstrip() + "\n" + HEARTBEAT_MODULE_LINE + "\n"


async def active_module_skill_prompt(session: AsyncSession, tenant_id: UUID) -> str:
    """Skills for on+connected modules; setup playbooks for on but unconnected."""
    enabled, _ = await tenant_module_sets(session, tenant_id)
    sections: list[str] = []
    for module in MODULES:
        if module.status != "available" or module.slug not in enabled:
            continue
        connections = await active_module_connections(session, tenant_id, module.slug)
        if connections:
            text = module_skill_text(module.slug)
            if text:
                sections.append(text)
        else:
            sections.append(module_setup_playbook(module))
    return "\n\n".join(sections)
