"""Module registry: which integration modules exist and what they offer.

A module is a first-class contract (schema, verbs, skill, setup playbook).
Connectors are the packages underneath. Agents choose a module, not a vendor,
unless the tenant has more than one package connected.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

MODULE_SKILL_DIR = Path(__file__).resolve().parent.parent / "data" / "module_skills"

ModuleStatus = Literal["available", "coming_soon"]
TenantModuleStatus = Literal["connected", "available", "coming_soon"]

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

    def tenant_status(self, *, connected: bool) -> TenantModuleStatus:
        if self.status == "coming_soon":
            return "coming_soon"
        return "connected" if connected else "available"

    def serialize(self, *, connected: bool = False) -> dict[str, Any]:
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
            "connected": connected if self.status == "available" else False,
            "tenant_status": self.tenant_status(connected=connected),
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
            "Open the Accounting module page.",
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
    "and accounting is not connected, use recommend_module; otherwise HEARTBEAT_OK"
)


def module_for_provider(provider_slug: str) -> str | None:
    return PROVIDER_MODULE.get(provider_slug)


def get_module(slug: str) -> ModuleSpec | None:
    return MODULE_BY_SLUG.get(slug)


def serialize_modules(*, connected_slugs: set[str] | None = None) -> list[dict[str, Any]]:
    """Public module rows for the marketplace API and agent tools."""
    connected = connected_slugs or set()
    return [m.serialize(connected=m.slug in connected) for m in MODULES]


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


async def serialize_modules_for_tenant(
    session: AsyncSession, tenant_id: UUID
) -> list[dict[str, Any]]:
    connected = await connected_module_slugs(session, tenant_id)
    return serialize_modules(connected_slugs=connected)


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
        f"## {module.name} module (not connected)\n"
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
    """Connected skills plus unconnected setup playbooks for available modules."""
    sections: list[str] = []
    for module in MODULES:
        if module.status != "available":
            continue
        connections = await active_module_connections(session, tenant_id, module.slug)
        if connections:
            text = module_skill_text(module.slug)
            if text:
                sections.append(text)
        else:
            sections.append(module_setup_playbook(module))
    return "\n\n".join(sections)
