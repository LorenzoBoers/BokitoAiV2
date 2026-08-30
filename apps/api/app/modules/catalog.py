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
MODULE_TOOL_PREFIXES: dict[str, str] = {
    "accounting": "accounting_",
    "banking": "banking_",
    "investing": "investing_",
    "documents": "documents_",
}

SETUP_PATH_PREFIX = "/modules"
WORKSPACE_PATH_PREFIX = "/ai/modules"


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
            "verbs": list(self.verbs),
            "propose_verbs": list(self.propose_verbs),
            "verb_labels": list(self.verb_labels),
            "needs_when": self.needs_when,
            "setup_steps": list(self.setup_steps),
            "capability_summary": self.capability_summary,
            "setup_path": self.setup_path,
            "workspace_path": self.workspace_path,
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
            "Install Accounting under Settings > Modules.",
            "Assign at least one AI agent (mark one as default for setup chat).",
            "Optionally enable a platform integration this module can use (KING, Bjorn Lunden, or Moneybird).",
            "If more than one administration appears, pick which one agents should use.",
            "Chat with the default agent to finish checklist items, then choose Finish setup.",
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
    """Read Tenant.settings_json.modules into {slug: enabled/installed}."""
    states = parse_module_install_states(settings)
    return {slug: state == "installed" for slug, state in states.items()}


def parse_module_install_states(
    settings: dict[str, Any] | None,
) -> dict[str, InstallState]:
    """Read install lifecycle per module slug."""
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
        # Legacy: enabled bool without install_state.
        if "enabled" in row:
            out[key] = "installed" if bool(row["enabled"]) else "not_installed"
    return out


def module_is_enabled(
    spec: ModuleSpec, *, connected: bool, flags: dict[str, bool]
) -> bool:
    """Tools and agent skills require install_state=installed (enabled flag)."""
    if spec.slug in flags:
        return flags[spec.slug]
    # Legacy tenants that only have a live connector and never flipped the switch
    # stay enabled so existing workspaces do not silently lose tools.
    return connected


def module_install_state_for(
    spec: ModuleSpec,
    *,
    connected: bool,
    states: dict[str, InstallState],
    flags: dict[str, bool],
) -> InstallState:
    if spec.status == "coming_soon":
        return "not_installed"
    if spec.slug in states:
        return states[spec.slug]
    if module_is_enabled(spec, connected=connected, flags=flags):
        return "installed"
    return "not_installed"


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
    """Return (enabled_slugs, connected_slugs) for a tenant.

    ``enabled_slugs`` means install_state=installed (tools available).
    """
    connected = await connected_module_slugs(session, tenant_id)
    settings = await _tenant_settings(session, tenant_id)
    flags = parse_module_flags(settings)
    states = parse_module_install_states(settings)
    enabled: set[str] = set()
    for module in MODULES:
        state = module_install_state_for(
            module,
            connected=module.slug in connected,
            states=states,
            flags=flags,
        )
        if state == "installed":
            enabled.add(module.slug)
    return enabled, connected


async def tenant_module_install_states(
    session: AsyncSession, tenant_id: UUID
) -> dict[str, InstallState]:
    connected = await connected_module_slugs(session, tenant_id)
    settings = await _tenant_settings(session, tenant_id)
    flags = parse_module_flags(settings)
    states = parse_module_install_states(settings)
    return {
        module.slug: module_install_state_for(
            module,
            connected=module.slug in connected,
            states=states,
            flags=flags,
        )
        for module in MODULES
        if module.status == "available"
    }


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
    for row in rows:
        summary = roster.get(row["slug"]) or {}
        row["assigned_agent_count"] = int(summary.get("assigned_agent_count") or 0)
        row["default_agent_id"] = summary.get("default_agent_id")
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
    row["install_state"] = install_state
    row["enabled"] = install_state == "installed"
    modules[slug] = row
    settings[MODULE_SETTINGS_KEY] = modules
    tenant.settings_json = json.dumps(settings)
    session.add(tenant)
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
    from app.services.module_agents import module_agent_count

    states = await tenant_module_install_states(session, tenant_id)
    current = states.get(slug, "not_installed")
    if current == "not_installed":
        raise ValueError("Install the module before finishing setup")
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


def module_prefs(settings: dict[str, Any] | None, slug: str) -> dict[str, Any]:
    raw = (settings or {}).get(MODULE_SETTINGS_KEY)
    if not isinstance(raw, dict):
        return {}
    row = raw.get(slug)
    return dict(row) if isinstance(row, dict) else {}


async def get_module_prefs(
    session: AsyncSession, tenant_id: UUID, slug: str
) -> dict[str, Any]:
    return module_prefs(await _tenant_settings(session, tenant_id), slug)


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
    from app.models.auth import Tenant

    tenant = await session.get(Tenant, tenant_id)
    if tenant is None:
        raise ValueError("Tenant not found")
    settings = await _tenant_settings(session, tenant_id)
    raw = settings.get(MODULE_SETTINGS_KEY)
    modules = dict(raw) if isinstance(raw, dict) else {}
    current = modules.get(slug)
    row = dict(current) if isinstance(current, dict) else {}
    if clear_default_connection:
        row.pop("default_connection_id", None)
    elif default_connection_id is not None:
        row["default_connection_id"] = str(default_connection_id).strip()
    if default_company_by_connection is not None:
        existing = row.get("default_company_by_connection")
        merged = dict(existing) if isinstance(existing, dict) else {}
        for key, value in default_company_by_connection.items():
            cid = str(key).strip()
            company = str(value or "").strip()
            if not cid:
                continue
            if company:
                merged[cid] = company
            else:
                merged.pop(cid, None)
        row["default_company_by_connection"] = merged
    if writes_enabled is not None:
        row["writes_enabled"] = bool(writes_enabled)
    if user_access is not None:
        mode = str(user_access.get("mode") or "all_members")
        if mode not in ("all_members", "selected"):
            mode = "all_members"
        user_ids = [str(u) for u in (user_access.get("user_ids") or []) if str(u).strip()]
        row["user_access"] = {"mode": mode, "user_ids": user_ids}
    modules[slug] = row
    settings[MODULE_SETTINGS_KEY] = modules
    tenant.settings_json = json.dumps(settings)
    session.add(tenant)
    await session.commit()
    return row


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
