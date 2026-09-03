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
ToolKind = Literal["read", "propose", "apply"]
# Public lifecycle shown in UI / nav. Legacy "off"/"on" still accepted when reading.
InstallState = Literal["not_installed", "setup", "installed"]
TenantModuleStatus = Literal[
    "not_installed",
    "setup",
    "installed",
    "connected",
    "coming_soon",
    # Legacy aliases kept for older clients.
    "off",
    "on",
]
MODULE_SETTINGS_KEY = "modules"

SETUP_PATH_PREFIX = "/connections"
# Same surface as setup: one module page (no separate /ai/modules workspace).
WORKSPACE_PATH_PREFIX = "/connections"


@dataclass(frozen=True)
class ModuleToolCard:
    """One agent tool exposed by a module (1:1 with the tool registry verb).

    ``props`` are extra JSON-schema input properties beyond the shared
    connection_id / company_id pair; tools are auto-registered from these
    cards (see app/tools/module_tools.py). ``apply`` cards execute approved
    writes: gated, mutating, and additionally behind the module write switch.
    """

    verb: str
    label: str
    description: str
    kind: ToolKind = "read"
    props: tuple[tuple[str, dict], ...] = ()
    required: tuple[str, ...] = ()

    @property
    def input_props(self) -> dict[str, Any]:
        return {name: dict(schema) for name, schema in self.props}

    def serialize(self) -> dict[str, Any]:
        return {
            "verb": self.verb,
            "label": self.label,
            "description": self.description,
            "kind": self.kind,
        }


@dataclass(frozen=True)
class ModuleSpec:
    slug: str
    name: str
    description: str
    status: ModuleStatus
    provider_slugs: tuple[str, ...]
    planned_provider_slugs: tuple[str, ...]
    tool_cards: tuple[ModuleToolCard, ...]
    needs_when: str
    setup_steps: tuple[str, ...]
    capability_summary: str
    # Apply verbs execute approved writes; not shown in the public card list.
    apply_cards: tuple[ModuleToolCard, ...] = ()

    @property
    def verbs(self) -> tuple[str, ...]:
        return tuple(c.verb for c in self.tool_cards if c.kind == "read")

    @property
    def propose_verbs(self) -> tuple[str, ...]:
        return tuple(c.verb for c in self.tool_cards if c.kind == "propose")

    @property
    def verb_labels(self) -> tuple[str, ...]:
        return tuple(c.label for c in self.tool_cards if c.kind == "read")

    @property
    def setup_path(self) -> str:
        return f"{SETUP_PATH_PREFIX}/{self.slug}"

    @property
    def workspace_path(self) -> str:
        return f"{WORKSPACE_PATH_PREFIX}/{self.slug}"

    def tenant_status(
        self,
        *,
        connected: bool,
        enabled: bool = False,
        install_state: InstallState | None = None,
    ) -> TenantModuleStatus:
        if self.status == "coming_soon":
            return "coming_soon"
        state = install_state or ("installed" if enabled else "not_installed")
        if state == "not_installed":
            return "not_installed"
        if state == "setup":
            return "setup"
        return "connected" if connected else "installed"

    def serialize(
        self,
        *,
        connected: bool = False,
        enabled: bool = False,
        install_state: InstallState | None = None,
        attached_connection_count: int = 0,
    ) -> dict[str, Any]:
        live = connected if self.status == "available" else False
        state: InstallState = install_state or (
            "installed" if enabled else "not_installed"
        )
        is_installed = state == "installed"
        return {
            "slug": self.slug,
            "name": self.name,
            "description": self.description,
            "status": self.status,
            "provider_slugs": list(self.provider_slugs),
            "planned_provider_slugs": list(self.planned_provider_slugs),
            "tool_cards": [c.serialize() for c in self.tool_cards],
            "verbs": list(self.verbs),
            "propose_verbs": list(self.propose_verbs),
            "verb_labels": list(self.verb_labels),
            "needs_when": self.needs_when,
            "setup_steps": list(self.setup_steps),
            "capability_summary": self.capability_summary,
            "setup_path": self.setup_path,
            "workspace_path": self.workspace_path,
            "attached_connection_count": attached_connection_count,
            "enabled": is_installed,
            "connected": live,
            "install_state": state,
            "tenant_status": self.tenant_status(
                connected=live, enabled=is_installed, install_state=state
            ),
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
        planned_provider_slugs=(
            "exact_online",
            "snelstart",
            "moneybird_mcp",
            "twinfield_mcp",
            "exact_online_mcp",
            "yuki_mcp",
            "pmb_exact_mcp",
        ),
        tool_cards=(
            ModuleToolCard(
                "list_companies",
                "Administrations",
                "List every administration (company file) available on connected packages.",
            ),
            ModuleToolCard(
                "get_company",
                "Administration detail",
                "Fetch one administration by id: name, currency, and package metadata.",
            ),
            ModuleToolCard(
                "search_parties",
                "Search contacts",
                "Search customers and suppliers by name, email, or chamber-of-commerce id.",
                props=(
                    ("query", {"type": "string"}),
                    ("role", {"type": "string", "enum": ["customer", "supplier"]}),
                ),
            ),
            ModuleToolCard(
                "get_party",
                "Contact detail",
                "Open one contact or supplier with addresses and payment details.",
                props=(
                    ("party_id", {"type": "string"}),
                    ("role", {"type": "string", "enum": ["customer", "supplier"]}),
                ),
            ),
            ModuleToolCard(
                "list_documents",
                "List invoices and bills",
                "List sales invoices and purchase bills, optionally filtered by status or party.",
                props=(
                    ("kind", {"type": "string", "enum": ["sales_invoice", "purchase_bill"]}),
                    ("status", {"type": "string", "description": "Optional status filter, e.g. open, paid, late."}),
                    ("from_date", {"type": "string", "description": "YYYY-MM-DD"}),
                    ("to_date", {"type": "string", "description": "YYYY-MM-DD"}),
                ),
            ),
            ModuleToolCard(
                "get_document",
                "Invoice or bill detail",
                "Fetch one invoice or bill including lines, totals, and payment state.",
                props=(("document_id", {"type": "string"}),),
            ),
            ModuleToolCard(
                "list_accounts",
                "Chart of accounts",
                "List ledger accounts (GL codes) used for booking.",
            ),
            ModuleToolCard(
                "get_account",
                "Account detail",
                "Fetch one ledger account with type and balance when the package provides it.",
                props=(("account_id", {"type": "string"}),),
            ),
            ModuleToolCard(
                "list_ledger",
                "Ledger entries",
                "List journal or ledger lines for a period or account.",
            ),
            ModuleToolCard(
                "list_outstanding",
                "Outstanding balances",
                "List open receivable and payable amounts per party or document.",
            ),
            ModuleToolCard(
                "list_bank_mutations",
                "Bank mutations",
                "List imported bank transactions waiting to be matched or booked.",
            ),
            ModuleToolCard(
                "summarize",
                "Summary",
                "Produce a short financial snapshot (open items, recent documents) for the agent.",
            ),
            ModuleToolCard(
                "propose_document",
                "Propose invoice or bill",
                "Draft a sales or purchase document; creates a decision before anything is written.",
                kind="propose",
            ),
            ModuleToolCard(
                "propose_party",
                "Propose contact",
                "Draft a new or updated customer/supplier; requires human approval to apply.",
                kind="propose",
            ),
            ModuleToolCard(
                "propose_booking",
                "Propose booking",
                "Draft a journal booking; applied only after you approve the decision.",
                kind="propose",
            ),
            ModuleToolCard(
                "propose_match",
                "Propose payment match",
                "Propose matching a bank mutation to an open document.",
                kind="propose",
            ),
            ModuleToolCard(
                "propose_send",
                "Propose send invoice",
                "Propose sending an invoice from the package; waits for your approval.",
                kind="propose",
            ),
        ),
        apply_cards=(
            ModuleToolCard(
                "apply_party",
                "Apply contact write",
                "Create or update a customer/supplier in the connected accounting package. "
                "Only runs after human approval; blocked while accounting writes are disabled.",
                kind="apply",
                props=(
                    ("role", {"type": "string", "enum": ["customer", "supplier"]}),
                    ("party_id", {"type": "string", "description": "Empty to create; set to update."}),
                    ("name", {"type": "string"}),
                    ("email", {"type": "string"}),
                    ("phone", {"type": "string"}),
                    ("street", {"type": "string"}),
                    ("postal_code", {"type": "string"}),
                    ("city", {"type": "string"}),
                    ("country", {"type": "string"}),
                ),
            ),
            ModuleToolCard(
                "apply_booking",
                "Apply journal booking",
                "Create a journal booking in the connected accounting package. "
                "Only runs after human approval; blocked while accounting writes are disabled.",
                kind="apply",
                props=(
                    ("journal", {"type": "string", "description": "Journal/dagboek code."}),
                    ("date", {"type": "string", "description": "YYYY-MM-DD"}),
                    ("description", {"type": "string"}),
                    ("reference", {"type": "string"}),
                    (
                        "lines",
                        {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "account": {"type": "string"},
                                    "description": {"type": "string"},
                                    "debit": {"type": "number"},
                                    "credit": {"type": "number"},
                                    "tax_code": {"type": "string"},
                                },
                                "required": ["account"],
                            },
                        },
                    ),
                ),
            ),
        ),
        needs_when="invoices, VAT, ledgers, outstanding balances, or bookkeeping",
        setup_steps=(
            "Install Accounting under Settings > Modules.",
            "Assign at least one AI agent (mark one as default for setup chat).",
            "Optionally enable a platform integration this module can use (KING, Bjorn Lunden, or Moneybird).",
            "If more than one administration appears, pick which one agents should use.",
            "Chat with the default agent to finish checklist items, then choose Finish setup.",
        ),
        capability_summary=(
            "Agents can list administrations, contacts, invoices, ledger lines, "
            "and outstanding balances."
        ),
    ),
    ModuleSpec(
        slug="banking",
        name="Banking",
        description=(
            "PSD2 / open-banking reads (accounts, balances, transactions); "
            "payments only as a proposal that a human approves."
        ),
        status="available",
        provider_slugs=("gocardless_bank",),
        planned_provider_slugs=("tink", "yapily", "knab"),
        tool_cards=(
            ModuleToolCard(
                "list_accounts",
                "Accounts",
                "List linked bank accounts across connected PSD2 providers.",
            ),
            ModuleToolCard(
                "get_balance",
                "Balances",
                "Read the current balance for a linked account.",
                props=(("account_id", {"type": "string"}),),
            ),
            ModuleToolCard(
                "list_transactions",
                "Transactions",
                "List recent bank transactions for reconciliation.",
                props=(("account_id", {"type": "string"}),),
            ),
            ModuleToolCard(
                "propose_payment",
                "Propose payment",
                "Draft an outgoing payment that only runs after you approve.",
                kind="propose",
            ),
        ),
        needs_when="bank balances, transactions, or outgoing payments",
        setup_steps=(
            "Install Banking under Settings > Modules.",
            "Assign at least one AI agent to the module roster.",
            "Connect a PSD2 provider (GoCardless Bank Account Data) with your secret id and key.",
            "Link bank accounts through the provider's requisition flow.",
        ),
        capability_summary=(
            "Agents can read accounts, balances, and transactions; payments "
            "only ship as proposals."
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
        tool_cards=(
            ModuleToolCard(
                "get_positions",
                "Positions",
                "List open positions from a connected broker when available.",
            ),
            ModuleToolCard(
                "get_quotes",
                "Quotes",
                "Fetch live or delayed quotes for symbols on the watchlist.",
            ),
            ModuleToolCard(
                "list_watchlist",
                "Watchlists",
                "List symbols the workspace is tracking.",
            ),
            ModuleToolCard(
                "propose_order",
                "Propose order",
                "Draft a trade order; execution waits for your approval.",
                kind="propose",
            ),
        ),
        needs_when="positions, quotes, watchlists, or trade orders",
        setup_steps=(
            "This module is prepared but not connectable yet.",
            "When a broker or market-data connector ships, orders will land as decisions.",
        ),
        capability_summary=("Later: positions, quotes, and watchlists."),
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
        tool_cards=(
            ModuleToolCard(
                "search",
                "Search files",
                "Search files across connected Drive / SharePoint / Dropbox.",
            ),
            ModuleToolCard(
                "list",
                "List files",
                "List files in a folder on the connected storage package.",
            ),
            ModuleToolCard(
                "get_content",
                "Read content",
                "Read file content into Knowledge for the agent to cite.",
            ),
            ModuleToolCard(
                "propose_upload",
                "Propose upload",
                "Propose uploading a file to external storage after approval.",
                kind="propose",
            ),
        ),
        needs_when="files that live in Drive, SharePoint, or Dropbox",
        setup_steps=(
            "This module is prepared but not connectable yet.",
            "When a storage connector ships, reads feed Knowledge and uploads stay decisions.",
        ),
        capability_summary=(
            "Later: search and read external files into Knowledge."
        ),
    ),
]

MODULE_BY_SLUG: dict[str, ModuleSpec] = {m.slug: m for m in MODULES}

# Registry tool names are always "{slug}_{verb}"; used to hide module tools
# when the module is off or the agent is not rostered.
MODULE_TOOL_PREFIXES: dict[str, str] = {m.slug: f"{m.slug}_" for m in MODULES}

PROVIDER_MODULE: dict[str, str] = {
    slug: module.slug for module in MODULES for slug in module.provider_slugs
}
for module in MODULES:
    for slug in module.planned_provider_slugs:
        PROVIDER_MODULE.setdefault(slug, module.slug)

HEARTBEAT_MODULE_LINE = (
    "- If company.md or open threads mention work a business module covers "
    "(see list_modules) and that module is off, use recommend_module so the "
    "operator can turn it on; otherwise HEARTBEAT_OK"
)


def module_for_provider(provider_slug: str) -> str | None:
    return PROVIDER_MODULE.get(provider_slug)


def get_module(slug: str) -> ModuleSpec | None:
    return MODULE_BY_SLUG.get(slug)


def parse_module_install_states(
    settings: dict[str, Any] | None,
) -> dict[str, InstallState]:
    """Legacy reader for Tenant.settings_json.modules (migration script only)."""
    raw = (settings or {}).get(MODULE_SETTINGS_KEY)
    if not isinstance(raw, dict):
        return {}
    out: dict[str, InstallState] = {}
    for slug, row in raw.items():
        key = str(slug)
        if isinstance(row, bool):
            out[key] = "installed" if row else "not_installed"
            continue
        if not isinstance(row, dict):
            continue
        raw_state = str(row.get("install_state") or "").strip().lower()
        if raw_state in ("not_installed", "setup", "installed"):
            out[key] = raw_state  # type: ignore[assignment]
            continue
        if "enabled" in row:
            out[key] = "installed" if bool(row["enabled"]) else "not_installed"
    return out


def serialize_modules(
    *,
    connected_slugs: set[str] | None = None,
    enabled_slugs: set[str] | None = None,
    install_states: dict[str, InstallState] | None = None,
) -> list[dict[str, Any]]:
    """Public module rows for the marketplace API and agent tools."""
    connected = connected_slugs or set()
    enabled = enabled_slugs if enabled_slugs is not None else set()
    states = install_states or {}
    rows: list[dict[str, Any]] = []
    for m in MODULES:
        state = states.get(m.slug)
        if state is None:
            state = "installed" if m.slug in enabled else "not_installed"
        rows.append(
            m.serialize(
                connected=m.slug in connected,
                enabled=state == "installed",
                install_state=state,
            )
        )
    return rows


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
    """Active IntegrationConnection rows attached to one module."""
    from app.models.integration import IntegrationConnection
    from app.services.module_attach import attached_connection_ids, provider_allowed_for_module

    spec = MODULE_BY_SLUG.get(module_slug)
    provider_slugs = list(spec.provider_slugs) if spec else []
    if not provider_slugs:
        return []
    attached = await attached_connection_ids(session, tenant_id, module_slug)
    if not attached:
        return []
    result = await session.execute(
        select(IntegrationConnection).where(
            IntegrationConnection.tenant_id == tenant_id,
            IntegrationConnection.provider.in_(provider_slugs),
            IntegrationConnection.status == "active",
        )
    )
    return [
        conn
        for conn in result.scalars().all()
        if str(conn.id) in attached and provider_allowed_for_module(conn.provider, module_slug)
    ]


async def connected_module_slugs(session: AsyncSession, tenant_id: UUID) -> set[str]:
    slugs: set[str] = set()
    for module in MODULES:
        if module.status != "available":
            continue
        if await active_module_connections(session, tenant_id, module.slug):
            slugs.add(module.slug)
    return slugs


async def _install_rows(
    session: AsyncSession, tenant_id: UUID
) -> dict[str, Any]:
    """All ModuleInstall rows for a tenant keyed by module slug."""
    from app.models.module_install import ModuleInstall

    result = await session.execute(
        select(ModuleInstall).where(ModuleInstall.tenant_id == tenant_id)
    )
    return {row.module_slug: row for row in result.scalars().all()}


async def _get_install(session: AsyncSession, tenant_id: UUID, slug: str) -> Any:
    from app.models.module_install import ModuleInstall

    result = await session.execute(
        select(ModuleInstall).where(
            ModuleInstall.tenant_id == tenant_id,
            ModuleInstall.module_slug == slug,
        )
    )
    return result.scalar_one_or_none()


def _load_json_dict(raw: str | None) -> dict[str, Any]:
    try:
        data = json.loads(raw or "{}")
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def _row_prefs(row: Any) -> dict[str, Any]:
    """Serialize a ModuleInstall row into the prefs dict the API exposes."""
    if row is None:
        return {}
    prefs: dict[str, Any] = {
        "install_state": row.install_state,
        "enabled": row.install_state == "installed",
        "writes_enabled": bool(row.writes_enabled),
    }
    if row.default_connection_id:
        prefs["default_connection_id"] = row.default_connection_id
    company_map = _load_json_dict(row.default_company_json)
    if company_map:
        prefs["default_company_by_connection"] = company_map
    user_access = _load_json_dict(row.user_access_json)
    if user_access:
        prefs["user_access"] = user_access
    return prefs


async def tenant_module_flags(session: AsyncSession, tenant_id: UUID) -> dict[str, bool]:
    states = await tenant_module_install_states(session, tenant_id)
    return {slug: state == "installed" for slug, state in states.items()}


async def tenant_module_sets(
    session: AsyncSession, tenant_id: UUID
) -> tuple[set[str], set[str]]:
    """Return (enabled_slugs, connected_slugs) for a tenant.

    ``enabled_slugs`` means install_state=installed (tools available).
    """
    connected = await connected_module_slugs(session, tenant_id)
    states = await tenant_module_install_states(session, tenant_id)
    enabled = {slug for slug, state in states.items() if state == "installed"}
    return enabled, connected


async def tenant_module_install_states(
    session: AsyncSession, tenant_id: UUID
) -> dict[str, InstallState]:
    rows = await _install_rows(session, tenant_id)
    out: dict[str, InstallState] = {}
    for module in MODULES:
        if module.status != "available":
            continue
        row = rows.get(module.slug)
        state = row.install_state if row is not None else "not_installed"
        if state not in ("not_installed", "setup", "installed"):
            state = "not_installed"
        out[module.slug] = state  # type: ignore[assignment]
    return out


async def enabled_module_slugs(session: AsyncSession, tenant_id: UUID) -> set[str]:
    enabled, _ = await tenant_module_sets(session, tenant_id)
    return enabled


async def module_is_on(session: AsyncSession, tenant_id: UUID, slug: str) -> bool:
    enabled, _ = await tenant_module_sets(session, tenant_id)
    return slug in enabled


async def user_can_access_module(
    session: AsyncSession,
    tenant_id: UUID,
    slug: str,
    *,
    user_id: Any,
    role: str,
) -> bool:
    """Per-user module access from prefs. Owners/admins always have access.

    ``user_access`` pref: {"mode": "all_members"|"selected", "user_ids": [...]}
    Missing pref or mode all_members = every member may use the module.
    """
    if role in ("owner", "admin"):
        return True
    prefs = await get_module_prefs(session, tenant_id, slug)
    user_access = prefs.get("user_access")
    if not isinstance(user_access, dict) or user_access.get("mode") != "selected":
        return True
    allowed = {str(u) for u in (user_access.get("user_ids") or [])}
    return str(user_id) in allowed


async def serialize_modules_for_tenant(
    session: AsyncSession, tenant_id: UUID
) -> list[dict[str, Any]]:
    enabled, connected = await tenant_module_sets(session, tenant_id)
    states = await tenant_module_install_states(session, tenant_id)
    rows = serialize_modules(
        connected_slugs=connected,
        enabled_slugs=enabled,
        install_states=states,
    )
    from app.services.module_agents import module_roster_summaries

    roster = await module_roster_summaries(session, tenant_id)
    from app.services.module_attach import attached_modules_by_connection
    from app.services.partner_mcp import list_attached_mcp_tools_by_module

    attach_counts: dict[str, int] = {}
    for slugs in (await attached_modules_by_connection(session, tenant_id)).values():
        for slug in slugs:
            attach_counts[slug] = attach_counts.get(slug, 0) + 1
    attached_tools = await list_attached_mcp_tools_by_module(session, tenant_id)
    for row in rows:
        summary = roster.get(row["slug"]) or {}
        row["assigned_agent_count"] = int(summary.get("assigned_agent_count") or 0)
        row["default_agent_id"] = summary.get("default_agent_id")
        row["attached_connection_count"] = attach_counts.get(row["slug"], 0)
        row["attached_mcp_tools"] = attached_tools.get(row["slug"], [])
    return rows


async def _write_module_row(
    session: AsyncSession,
    tenant_id: UUID,
    slug: str,
    *,
    install_state: InstallState,
    actor_id: Any = None,
    audit_action: str,
    summary: str,
) -> dict[str, Any]:
    spec = MODULE_BY_SLUG.get(slug)
    if spec is None:
        raise ValueError(f"Unknown module '{slug}'")
    if spec.status == "coming_soon" and install_state != "not_installed":
        raise ValueError(f"Module '{slug}' is not available yet")
    from datetime import datetime as _dt

    from app.models.module_install import ModuleInstall
    from app.services.audit import record_audit

    row = await _get_install(session, tenant_id, slug)
    if row is None:
        row = ModuleInstall(tenant_id=tenant_id, module_slug=slug)
    row.install_state = install_state
    row.updated_at = _dt.utcnow()
    session.add(row)
    await session.commit()
    await record_audit(
        session,
        tenant_id,
        action=audit_action,
        actor_type="user" if actor_id else "system",
        actor_id=str(actor_id) if actor_id else "",
        resource_type="module",
        resource_id=slug,
        summary=summary,
        after={
            "slug": slug,
            "install_state": install_state,
            "enabled": install_state == "installed",
        },
    )
    if install_state in ("setup", "installed"):
        from app.services.module_sources import ensure_platform_seeds

        await ensure_platform_seeds(session, tenant_id, slug)
    rows = {m["slug"]: m for m in await serialize_modules_for_tenant(session, tenant_id)}
    return rows[slug]


async def set_module_enabled(
    session: AsyncSession,
    tenant_id: UUID,
    slug: str,
    enabled: bool,
    *,
    actor_id: Any = None,
) -> dict[str, Any]:
    """Legacy on/off: maps to installed / not_installed."""
    if enabled:
        from app.services.module_agents import module_agent_count

        if await module_agent_count(session, tenant_id, slug) < 1:
            raise ValueError(
                "Assign at least one AI agent to this module before finishing setup"
            )
        return await _write_module_row(
            session,
            tenant_id,
            slug,
            install_state="installed",
            actor_id=actor_id,
            audit_action="module:enabled",
            summary=f"{MODULE_BY_SLUG[slug].name} installed",
        )
    from app.services.module_agents import clear_module_agents

    row = await _write_module_row(
        session,
        tenant_id,
        slug,
        install_state="not_installed",
        actor_id=actor_id,
        audit_action="module:disabled",
        summary=f"{MODULE_BY_SLUG[slug].name} uninstalled",
    )
    await clear_module_agents(session, tenant_id, slug)
    row["assigned_agent_count"] = 0
    row["default_agent_id"] = None
    return row


async def install_module(
    session: AsyncSession,
    tenant_id: UUID,
    slug: str,
    *,
    actor_id: Any = None,
) -> dict[str, Any]:
    """Start install: module enters setup until the operator finishes setup."""
    return await _write_module_row(
        session,
        tenant_id,
        slug,
        install_state="setup",
        actor_id=actor_id,
        audit_action="module:install_started",
        summary=f"{MODULE_BY_SLUG[slug].name} install started",
    )


async def complete_module_setup(
    session: AsyncSession,
    tenant_id: UUID,
    slug: str,
    *,
    actor_id: Any = None,
) -> dict[str, Any]:
    """Mark setup done → installed (tools + AI nav). Requires ≥1 assigned agent."""
    from app.services.module_agents import add_module_agent, module_agent_count

    states = await tenant_module_install_states(session, tenant_id)
    current = states.get(slug, "not_installed")
    if current == "not_installed":
        raise ValueError("Install the module before finishing setup")
    if await module_agent_count(session, tenant_id, slug) < 1:
        from app.services.lead_agent import get_lead_agent

        lead = await get_lead_agent(session, tenant_id)
        if lead is None:
            raise ValueError(
                "Assign at least one AI agent to this module before finishing setup"
            )
        await add_module_agent(session, tenant_id, slug, lead.id, is_default=True)
    return await _write_module_row(
        session,
        tenant_id,
        slug,
        install_state="installed",
        actor_id=actor_id,
        audit_action="module:installed",
        summary=f"{MODULE_BY_SLUG[slug].name} installed",
    )


async def uninstall_module(
    session: AsyncSession,
    tenant_id: UUID,
    slug: str,
    *,
    actor_id: Any = None,
) -> dict[str, Any]:
    """Remove module from the tenant. Connections stay on the platform."""
    from app.services.module_agents import clear_module_agents

    row = await _write_module_row(
        session,
        tenant_id,
        slug,
        install_state="not_installed",
        actor_id=actor_id,
        audit_action="module:uninstalled",
        summary=f"{MODULE_BY_SLUG[slug].name} uninstalled",
    )
    await clear_module_agents(session, tenant_id, slug)
    row["assigned_agent_count"] = 0
    row["default_agent_id"] = None
    return row


async def enable_module_for_provider(
    session: AsyncSession, tenant_id: UUID, provider_slug: str
) -> None:
    """When a package is connected, move the parent module into setup if needed.

    Finishing install still requires assigning at least one agent via
    ``complete_module_setup``.
    """
    slug = module_for_provider(provider_slug)
    if not slug:
        return
    states = await tenant_module_install_states(session, tenant_id)
    current = states.get(slug, "not_installed")
    if current in ("installed", "setup"):
        return
    await _write_module_row(
        session,
        tenant_id,
        slug,
        install_state="setup",
        audit_action="module:install_started",
        summary=f"{MODULE_BY_SLUG[slug].name} setup started via package",
    )


async def get_module_prefs(
    session: AsyncSession, tenant_id: UUID, slug: str
) -> dict[str, Any]:
    return _row_prefs(await _get_install(session, tenant_id, slug))


async def update_module_prefs(
    session: AsyncSession,
    tenant_id: UUID,
    slug: str,
    *,
    default_connection_id: str | None = None,
    default_company_by_connection: dict[str, str] | None = None,
    clear_default_connection: bool = False,
    writes_enabled: bool | None = None,
    user_access: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Persist operator defaults for multi-registration modules."""
    if MODULE_BY_SLUG.get(slug) is None:
        raise ValueError(f"Unknown module '{slug}'")
    from datetime import datetime as _dt

    from app.models.module_install import ModuleInstall

    row = await _get_install(session, tenant_id, slug)
    if row is None:
        # Defaults may be set while the module is still in setup.
        row = ModuleInstall(tenant_id=tenant_id, module_slug=slug)
    if clear_default_connection:
        row.default_connection_id = None
    elif default_connection_id is not None:
        row.default_connection_id = str(default_connection_id).strip() or None
    if default_company_by_connection is not None:
        merged = _load_json_dict(row.default_company_json)
        for key, value in default_company_by_connection.items():
            cid = str(key).strip()
            company = str(value or "").strip()
            if not cid:
                continue
            if company:
                merged[cid] = company
            else:
                merged.pop(cid, None)
        row.default_company_json = json.dumps(merged)
    if writes_enabled is not None:
        row.writes_enabled = bool(writes_enabled)
    if user_access is not None:
        mode = str(user_access.get("mode") or "all_members")
        if mode not in ("all_members", "selected"):
            mode = "all_members"
        user_ids = [str(u) for u in (user_access.get("user_ids") or []) if str(u).strip()]
        row.user_access_json = json.dumps({"mode": mode, "user_ids": user_ids})
    row.updated_at = _dt.utcnow()
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return _row_prefs(row)


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
        f"Setup: {module.setup_path} (tabs: Overview, Connections, Sources, Setup)\n"
        f"Success: module on, at least one healthy registration, defaults set, "
        f"platform sources indexed (or explicitly skipped).\n"
        f"Tools: list_module_connections, set_module_default_connection, "
        f"list_module_sources, propose_module_source.\n"
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
