"""Module registry: which integration modules exist and what they offer.

A module is a first-class contract (schema, verbs, skill, setup playbook).
Connectors are the packages underneath. Agents choose a module, not a vendor,
unless the tenant has more than one package connected.
"""

from __future__ import annotations

from app.core.time import utcnow

import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

MODULE_SKILL_DIR = Path(__file__).resolve().parent.parent / "data" / "module_skills"

ModuleStatus = Literal["available", "coming_soon"]
ToolKind = Literal["read", "propose", "apply"]
ToolExposure = Literal["internal", "customer", "both"]
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
    exposure: ToolExposure = "internal"
    sensitivity: str = "none"
    min_assurance: str = "none"

    @property
    def input_props(self) -> dict[str, Any]:
        return {name: dict(schema) for name, schema in self.props}

    def serialize(self) -> dict[str, Any]:
        return {
            "verb": self.verb,
            "label": self.label,
            "description": self.description,
            "kind": self.kind,
            "exposure": self.exposure,
            "sensitivity": self.sensitivity,
            "min_assurance": self.min_assurance,
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
        return tuple(
            c.verb
            for c in self.tool_cards
            if c.kind == "read" and c.exposure != "customer"
        )

    @property
    def propose_verbs(self) -> tuple[str, ...]:
        return tuple(c.verb for c in self.tool_cards if c.kind == "propose")

    @property
    def verb_labels(self) -> tuple[str, ...]:
        return tuple(
            c.label
            for c in self.tool_cards
            if c.kind == "read" and c.exposure != "customer"
        )

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
        package = MODULE_PACKAGES.get(self.slug)
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
            "package": package.serialize() if package else None,
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
                "list_my_invoices",
                "My invoices",
                "List sales invoices that belong to the verified customer on this conversation.",
                exposure="customer",
                sensitivity="financial",
                min_assurance="verified",
            ),
            ModuleToolCard(
                "list_my_documents",
                "My documents",
                "List invoices and bills that belong to the verified customer on this conversation.",
                exposure="customer",
                sensitivity="financial",
                min_assurance="verified",
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
        status="available",
        provider_slugs=("google_drive",),
        planned_provider_slugs=("microsoft_graph_files", "dropbox"),
        tool_cards=(
            ModuleToolCard(
                "search",
                "Search files",
                "Search files on the connected Google Drive by name or text.",
                props=(("query", {"type": "string"}), ("limit", {"type": "integer"})),
            ),
            ModuleToolCard(
                "list",
                "List files",
                "List files in a Drive folder (folder_id, default the root), newest first.",
                props=(("folder_id", {"type": "string"}), ("limit", {"type": "integer"})),
            ),
            ModuleToolCard(
                "get_content",
                "Read content",
                "Read a file's text (Docs as text, Sheets as CSV) for the agent to cite.",
                props=(("file_id", {"type": "string"}),),
                required=("file_id",),
            ),
            ModuleToolCard(
                "sheets_read",
                "Read sheet",
                "Read cell values from a Google Sheet range (A1 notation).",
                props=(("spreadsheet_id", {"type": "string"}), ("range", {"type": "string"})),
                required=("spreadsheet_id",),
            ),
            ModuleToolCard(
                "propose_upload",
                "Propose upload",
                "Propose uploading a file to external storage after approval.",
                kind="propose",
            ),
        ),
        apply_cards=(
            ModuleToolCard(
                "sheets_append",
                "Append rows",
                "Append rows to a Google Sheet range. Writes ask first under the workspace allowance.",
                kind="apply",
                props=(
                    ("spreadsheet_id", {"type": "string"}),
                    ("range", {"type": "string"}),
                    ("values", {"type": "array", "items": {"type": "array", "items": {}}}),
                ),
                required=("spreadsheet_id", "values"),
            ),
            ModuleToolCard(
                "sheets_update",
                "Update cells",
                "Overwrite a Google Sheet range with rows. Writes ask first under the workspace allowance.",
                kind="apply",
                props=(
                    ("spreadsheet_id", {"type": "string"}),
                    ("range", {"type": "string"}),
                    ("values", {"type": "array", "items": {"type": "array", "items": {}}}),
                ),
                required=("spreadsheet_id", "range", "values"),
            ),
        ),
        needs_when="files that live in Drive, or rows in a Google Sheet",
        setup_steps=(
            "Install Documents under Settings > Modules.",
            "Connect Google Drive under Connections (read access to Drive, read and write to Sheets).",
            "Link a folder or Sheet to a client folder as a resource when the agent should use it there.",
        ),
        capability_summary=(
            "Agents search and read Drive files and Sheets; writing to a Sheet asks first."
        ),
    ),
    ModuleSpec(
        slug="accountant",
        name="Accountant",
        description=(
            "Reviews the books already connected on Accounting: trial balance, "
            "statements, VAT, aged items, and exceptions. Closing the period "
            "stays a proposal you approve. No separate package login."
        ),
        status="coming_soon",
        provider_slugs=(),
        planned_provider_slugs=(
            "king_accountancy",
            "bjorn_lunden_mcp",
            "moneybird",
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
                "trial_balance",
                "Trial balance",
                "Trial balance for a period, compared with the previous period.",
            ),
            ModuleToolCard(
                "statements",
                "Profit and balance",
                "Profit and loss and balance sheet for a period.",
            ),
            ModuleToolCard(
                "vat_position",
                "VAT position",
                "VAT to pay or reclaim, with the lines that still do not tie out.",
            ),
            ModuleToolCard(
                "aged_balances",
                "Aged balances",
                "Open receivables and payables in age buckets.",
            ),
            ModuleToolCard(
                "anomalies",
                "Exceptions",
                "Bookings without a document, duplicates, and accounts far from last month.",
            ),
            ModuleToolCard(
                "unmatched_bank",
                "Unmatched bank",
                "Bank lines the books have not matched yet.",
            ),
            ModuleToolCard(
                "propose_close",
                "Propose period close",
                "Propose closing the period after the checklist is done. Waits for your approval.",
                kind="propose",
            ),
            ModuleToolCard(
                "request_documents",
                "Request missing documents",
                "Ask in the conversation for the documents that are still missing.",
                kind="propose",
            ),
        ),
        needs_when="period close, VAT review, or exceptions in the books",
        setup_steps=(
            "This module is an idea and is not connectable yet.",
            "It will read the same packages as Accounting. It does not add a login.",
            "Writes stay on Accounting and still wait for approval.",
        ),
        capability_summary=(
            "Later: review trial balance, VAT, aged items, and exceptions "
            "on the packages Accounting already uses."
        ),
    ),
]

MODULE_BY_SLUG: dict[str, ModuleSpec] = {m.slug: m for m in MODULES}


@dataclass(frozen=True)
class WorkstreamTemplate:
    """Pre-built workstream a module ships. Installing copies it to the
    tenant (the tenant owns and may edit the copy); the requirements manifest
    is checked at install time and again before every run of the copy."""

    slug: str
    module_slug: str
    name: str
    description: str
    # Step payloads in `replace_steps` shape: name, kind, goal, agent_role,
    # wait_kind, deadline_hours, on_deadline.
    steps: tuple[dict[str, Any], ...]
    # Requirements manifest.
    required_agent_roles: tuple[str, ...] = ()
    requires_module_connection: bool = False

    def serialize(self) -> dict[str, Any]:
        """Public template row. Step goals stay on the server and are copied at install."""
        steps = [{k: v for k, v in step.items() if k != "goal"} for step in self.steps]
        return {
            "slug": self.slug,
            "module_slug": self.module_slug,
            "name": self.name,
            "description": self.description,
            "steps": steps,
            "steps_count": len(self.steps),
            "required_agent_roles": list(self.required_agent_roles),
            "requires_module_connection": self.requires_module_connection,
        }


WORKSTREAM_TEMPLATES: dict[str, tuple[WorkstreamTemplate, ...]] = {
    "accounting": (
        WorkstreamTemplate(
            slug="vat-filing-prep",
            module_slug="accounting",
            name="VAT filing preparation",
            description=(
                "Collect the figures for the VAT period, chase missing "
                "documents, and deliver an approved filing summary."
            ),
            steps=(
                {
                    "name": "Collect figures",
                    "kind": "agent_task",
                    "goal": (
                        "Use the accounting module tools (list_documents, "
                        "list_ledger, list_outstanding) to collect the figures "
                        "for the VAT period named in the run input. List the "
                        "totals per rate, note documents that look incomplete "
                        "or unbooked, and end with the open questions."
                    ),
                },
                {
                    "name": "Wait for missing documents",
                    "kind": "wait_for_reply",
                    "wait_kind": "input",
                    "deadline_hours": 72,
                    "on_deadline": "remind_then_continue",
                },
                {
                    "name": "Approve filing summary",
                    "kind": "ask_decision",
                    "goal": "Review the collected figures before the filing summary is finalized.",
                },
                {
                    "name": "Finalize filing summary",
                    "kind": "agent_task",
                    "goal": (
                        "Write the final VAT filing summary: totals per rate, "
                        "corrections applied, and the amounts to file. Note "
                        "anything that still needs a bookkeeper's eye."
                    ),
                },
            ),
            requires_module_connection=True,
        ),
        WorkstreamTemplate(
            slug="monthly-close-review",
            module_slug="accounting",
            name="Monthly close review",
            description=(
                "Review the month: unbooked bank mutations, open invoices, "
                "and a short close report after approval."
            ),
            steps=(
                {
                    "name": "Review the month",
                    "kind": "agent_task",
                    "goal": (
                        "Review the month named in the run input with the "
                        "accounting module tools: unmatched bank mutations "
                        "(list_bank_mutations), overdue invoices "
                        "(list_outstanding), and unusual ledger movements. "
                        "Summarize what needs action."
                    ),
                },
                {
                    "name": "Approve close report",
                    "kind": "ask_decision",
                    "goal": "Confirm the findings before the close report is written.",
                },
                {
                    "name": "Write close report",
                    "kind": "agent_task",
                    "goal": (
                        "Write the monthly close report from the approved "
                        "findings: key numbers, resolved items, and the "
                        "follow-ups for next month."
                    ),
                },
            ),
            requires_module_connection=True,
        ),
    ),
    "banking": (
        WorkstreamTemplate(
            slug="bank-reconciliation",
            module_slug="banking",
            name="Bank reconciliation",
            description=(
                "Match recent bank transactions against open items and "
                "report what remains unmatched."
            ),
            steps=(
                {
                    "name": "Match transactions",
                    "kind": "agent_task",
                    "goal": (
                        "List recent transactions on the linked bank accounts "
                        "(list_transactions) and match them against open items. "
                        "Report matched pairs and everything that stays "
                        "unmatched with a suggested follow-up."
                    ),
                },
            ),
            requires_module_connection=True,
        ),
    ),
}


def module_workstream_templates(module_slug: str) -> tuple[WorkstreamTemplate, ...]:
    package = MODULE_PACKAGES.get(module_slug)
    return package.playbooks if package else ()


def get_workstream_template(
    module_slug: str, template_slug: str
) -> WorkstreamTemplate | None:
    for template in module_workstream_templates(module_slug):
        if template.slug == template_slug:
            return template
    return None


@dataclass(frozen=True)
class TagTemplate:
    """Hashtag a module ships. Installing registers it; attaching a playbook
    makes it a category."""

    slug: str
    module_slug: str
    name: str
    description: str
    create_mode: str = "ask_customer"
    ask_threshold: int = 6
    auto_threshold: int = 11
    requires_verification: bool = False

    def serialize(self) -> dict[str, Any]:
        return {
            "slug": self.slug,
            "module_slug": self.module_slug,
            "name": self.name,
            "description": self.description,
            "create_mode": self.create_mode,
            "ask_threshold": self.ask_threshold,
            "auto_threshold": self.auto_threshold,
            "requires_verification": self.requires_verification,
        }


# Starter hashtags for a new workspace. Free tags until an operator attaches a
# playbook (promote), which makes them categories.
PLATFORM_TAG_SEEDS: tuple[dict[str, Any], ...] = (
    {
        "name": "factuur",
        "description": "Vraag of geschil over een factuur, betaling of aanmaning.",
        "sort_order": 5,
    },
    {
        "name": "klacht",
        "description": "Een klant is ontevreden en wil dit vastgelegd hebben.",
        "sort_order": 10,
    },
    {
        "name": "storing",
        "description": "Iets werkt niet en moet bekeken worden.",
        "sort_order": 20,
    },
    {
        "name": "functieverzoek",
        "description": "Een verzoek om een nieuwe of verbeterde mogelijkheid.",
        "sort_order": 30,
    },
    {
        "name": "spam",
        "description": "Ongewenst of misbruikend verkeer dat snel dicht mag.",
        "sort_order": 40,
    },
)


TAG_TEMPLATES: dict[str, tuple[TagTemplate, ...]] = {
    "accounting": (
        TagTemplate(
            slug="billing_inquiry",
            module_slug="accounting",
            name="factuurvraag",
            description=(
                "Een klant vraagt naar een factuur, saldo of betaling. "
                "Vereist een bevestigd e-mailadres voordat dossiers mogen worden opgezocht."
            ),
            create_mode="ask_customer",
            requires_verification=True,
        ),
    ),
}


def module_tag_templates(module_slug: str) -> tuple[TagTemplate, ...]:
    package = MODULE_PACKAGES.get(module_slug)
    return package.tags if package else ()


def get_tag_template(module_slug: str, template_slug: str) -> TagTemplate | None:
    for template in module_tag_templates(module_slug):
        if template.slug == template_slug:
            return template
    return None


@dataclass(frozen=True)
class ProjectTemplate:
    """Folder a module creates on install, with the Works in item its work lands on.

    The item is the module's connection when one is active; otherwise a canvas.
    """

    module_slug: str
    name: str
    name_nl: str
    canvas_title: str
    canvas_title_nl: str

    def folder_name(self, language: str) -> str:
        return self.name_nl if language == "nl" else self.name

    def canvas_name(self, language: str) -> str:
        return self.canvas_title_nl if language == "nl" else self.canvas_title

    def serialize(self) -> dict[str, Any]:
        return {"module_slug": self.module_slug, "name": self.name, "name_nl": self.name_nl}


PROJECT_TEMPLATES: dict[str, ProjectTemplate] = {
    "accounting": ProjectTemplate(
        module_slug="accounting",
        name="Administration",
        name_nl="Administratie",
        canvas_title="Figures",
        canvas_title_nl="Cijfers",
    ),
}


@dataclass(frozen=True)
class ModuleAgentTemplate:
    """Managed specialist hired when a module is set up (not a new Set-C noun)."""

    name: str
    # Short function label (Agent.job_title is 20 characters).
    job_title: str
    # Operator-facing job description. Not the system prompt.
    role_blurb: str
    system_prompt: str = ""
    avatar_color: str = "#9159fe"
    avatar_shape: str = "bokito"
    # Extra passport tools beyond module verbs + minimal messaging.
    extra_tools: tuple[str, ...] = ()

    def serialize(self) -> dict[str, Any]:
        """Public marketplace row. The prompt and extra tools stay on the server."""
        return {
            "name": self.name,
            "job_title": self.job_title[:20],
            "role_blurb": self.role_blurb,
            "avatar_color": self.avatar_color,
            "avatar_shape": self.avatar_shape,
        }


@dataclass(frozen=True)
class ModulePackage:
    """Installable module contents: hashtags, playbooks, optional Project."""

    module_slug: str
    tags: tuple[TagTemplate, ...]
    playbooks: tuple[WorkstreamTemplate, ...]
    project: ProjectTemplate | None = None
    agent_template: ModuleAgentTemplate | None = None

    def serialize(self) -> dict[str, Any]:
        return {
            "module_slug": self.module_slug,
            "tags": [item.serialize() for item in self.tags],
            "playbooks": [item.serialize() for item in self.playbooks],
            "project": self.project.serialize() if self.project else None,
            "agent_template": (
                self.agent_template.serialize() if self.agent_template else None
            ),
        }


def _module_persona(module: ModuleSpec) -> ModuleAgentTemplate:
    """Named expert shipped with the module. Hire copies this onto the agent."""
    persona = _MODULE_PERSONAS.get(module.slug)
    if persona is not None:
        return persona
    return ModuleAgentTemplate(
        name=f"{module.name} specialist",
        job_title="Specialist",
        role_blurb=(
            f"Owns {module.name}: its tools, labels and flows. "
            f"Hands anything outside this module back to the lead."
        ),
        system_prompt=_specialist_prompt(module, f"{module.name} specialist", "Specialist"),
    )


def _specialist_prompt(module: ModuleSpec, name: str, job_title: str) -> str:
    return (
        f"You are {name}, {job_title}, the expert hired for the {module.name} module. "
        f"You can use every tool, label and flow that shipped with this module. "
        f"Read tools you may call directly. Propose and apply tools only through a "
        f"decision the operator approves. Workspace basics are yours too: folders, "
        f"labels, contacts and conversations. Hand work that belongs to another "
        f"module's expert back to the lead with handoff_to. "
        f"Do not send external customer replies unless asked. "
        f"When setup is incomplete, guide the operator through connecting the "
        f"package and finishing install."
    )


# Proper names stay the same in every language. Job title and blurb on the
# card are translated in the dashboard; hire stores these English fields.
_MODULE_PERSONAS: dict[str, ModuleAgentTemplate] = {
    "accounting": ModuleAgentTemplate(
        name="Boekito",
        job_title="Controller",
        role_blurb=(
            "Keeps the books for this workspace: administrations, contacts, "
            "invoices, ledger lines and open balances. Bookings and payment "
            "matches wait for your approval."
        ),
        avatar_color="#00bca6",
        avatar_shape="shield",
        system_prompt="",
    ),
    "banking": ModuleAgentTemplate(
        name="Finito",
        job_title="Treasurer",
        role_blurb=(
            "Watches linked accounts, balances and transactions. "
            "Outgoing payments only leave as a proposal you approve."
        ),
        avatar_color="#1084fe",
        avatar_shape="capsule",
        system_prompt="",
    ),
    "investing": ModuleAgentTemplate(
        name="Investo",
        job_title="Markets lead",
        role_blurb=(
            "Follows positions, quotes and watchlists. "
            "Trade orders wait for your approval."
        ),
        avatar_color="#ff9800",
        avatar_shape="crystal",
        system_prompt="",
    ),
    "documents": ModuleAgentTemplate(
        name="Documento",
        job_title="Archivist",
        role_blurb=(
            "Finds and reads files in connected storage so the team can cite them. "
            "Uploads wait for your approval."
        ),
        avatar_color="#9159fe",
        avatar_shape="squircle",
        system_prompt="",
    ),
    "accountant": ModuleAgentTemplate(
        name="Accounto",
        job_title="Accountant",
        role_blurb=(
            "Reviews the period on the packages Accounting already connected: "
            "trial balance, VAT, aged items, and exceptions. "
            "A close waits for your approval. Bookings stay with Accounting."
        ),
        avatar_color="#c4a35a",
        avatar_shape="hex",
        system_prompt="",
    ),
}


def _apply_persona_avatar(agent: Any, template: ModuleAgentTemplate) -> None:
    """Give a hired specialist the module orb when they do not have a mark yet."""
    import json

    from app.services.agent_avatar import _settings, apply_avatar_settings

    stored = _settings(agent.settings_json)
    if str(stored.get("avatar_kind") or "").strip():
        return
    merged = apply_avatar_settings(
        stored,
        avatar_kind="orb",
        avatar_color=template.avatar_color,
        avatar_shape=template.avatar_shape,
    )
    agent.settings_json = json.dumps(merged)


def _persona_with_prompt(module: ModuleSpec) -> ModuleAgentTemplate:
    persona = _module_persona(module)
    if persona.system_prompt:
        return persona
    return ModuleAgentTemplate(
        name=persona.name,
        job_title=persona.job_title,
        role_blurb=persona.role_blurb,
        system_prompt=_specialist_prompt(module, persona.name, persona.job_title),
        avatar_color=persona.avatar_color,
        avatar_shape=persona.avatar_shape,
        extra_tools=persona.extra_tools,
    )


MODULE_PACKAGES: dict[str, ModulePackage] = {
    module.slug: ModulePackage(
        module_slug=module.slug,
        tags=TAG_TEMPLATES.get(module.slug, ()),
        playbooks=WORKSTREAM_TEMPLATES.get(module.slug, ()),
        project=PROJECT_TEMPLATES.get(module.slug),
        agent_template=_persona_with_prompt(module),
    )
    for module in MODULES
}


def get_module_package(module_slug: str) -> ModulePackage | None:
    return MODULE_PACKAGES.get(module_slug)

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
    "(see list_modules) and that module is off, use recommend_module once so "
    "the operator can turn it on. When the module is on and list_modules shows "
    "specialist_agent_id, bring that agent in with ask_agent or handoff_to; "
    "do not do module specialist work yourself. "
    "Never repeat a recommendation that is still open or was declined; "
    "otherwise HEARTBEAT_OK"
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


def _load_json_dict(raw: str | None) -> dict[str, Any]:
    try:
        data = json.loads(raw or "{}")
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


async def tenant_module_flags(session: AsyncSession, tenant_id: UUID) -> dict[str, bool]:
    states = await tenant_module_install_states(session, tenant_id)
    return {slug: state == "installed" for slug, state in states.items()}


async def tenant_module_sets(
    session: AsyncSession, tenant_id: UUID
) -> tuple[set[str], set[str]]:
    """Return (enabled_slugs, connected_slugs) for a tenant.

    ``enabled_slugs`` = live department with ``origin_module_slug``.
    """
    connected = await connected_module_slugs(session, tenant_id)
    states = await tenant_module_install_states(session, tenant_id)
    enabled = {slug for slug, state in states.items() if state == "installed"}
    return enabled, connected


async def tenant_module_install_states(
    session: AsyncSession, tenant_id: UUID
) -> dict[str, InstallState]:
    from app.services.module_origin import installed_module_slugs

    installed = await installed_module_slugs(session, tenant_id)
    out: dict[str, InstallState] = {}
    for module in MODULES:
        if module.status != "available":
            continue
        out[module.slug] = "installed" if module.slug in installed else "not_installed"
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
    session: AsyncSession,
    tenant_id: UUID,
    *,
    include_coming_soon: bool = False,
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
        row["default_agent_name"] = summary.get("default_agent_name")
        row["specialist_agent_id"] = summary.get("specialist_agent_id")
        row["specialist_agent_name"] = summary.get("specialist_agent_name")
        row["has_managed_specialist"] = bool(summary.get("has_managed_specialist"))
        row["specialist_avatar_kind"] = summary.get("specialist_avatar_kind")
        row["specialist_avatar_icon"] = summary.get("specialist_avatar_icon")
        row["specialist_avatar_color"] = summary.get("specialist_avatar_color")
        row["specialist_avatar_shape"] = summary.get("specialist_avatar_shape")
        row["specialist_avatar_image_url"] = summary.get("specialist_avatar_image_url")
        row["attached_connection_count"] = attach_counts.get(row["slug"], 0)
        row["attached_mcp_tools"] = attached_tools.get(row["slug"], [])
    if not include_coming_soon:
        rows = [
            row
            for row in rows
            if row.get("status") != "coming_soon" or row.get("enabled")
        ]
    return rows


async def _serialize_module_row(session: AsyncSession, tenant_id: UUID, slug: str) -> dict[str, Any]:
    rows = {
        m["slug"]: m
        for m in await serialize_modules_for_tenant(session, tenant_id, include_coming_soon=True)
    }
    if slug not in rows:
        raise ValueError(f"Unknown module '{slug}'")
    from app.services.module_origin import get_module_department, module_prefs_from_department

    dept = await get_module_department(session, tenant_id, slug)
    row = rows[slug]
    prefs = module_prefs_from_department(dept)
    row.update({k: v for k, v in prefs.items() if k not in ("install_state", "enabled")})
    if dept is not None:
        row["department_id"] = str(dept.id)
    return row


async def set_module_enabled(
    session: AsyncSession,
    tenant_id: UUID,
    slug: str,
    enabled: bool,
    *,
    actor_id: Any = None,
) -> dict[str, Any]:
    """On = one-time install drop; off = delete origin department."""
    if enabled:
        return await install_module(session, tenant_id, slug, actor_id=actor_id)
    return await uninstall_module(session, tenant_id, slug, actor_id=actor_id)


async def install_module(
    session: AsyncSession,
    tenant_id: UUID,
    slug: str,
    *,
    actor_id: Any = None,
    hire_specialist: bool = True,
    department_id: UUID | None = None,
    accountable_user_id: UUID | None = None,
    specialist_leads: bool | None = None,
) -> dict[str, Any]:
    """One-time drop: department + specialist + package assets. Idempotent.

    ``department_id`` installs into an existing department instead of a new one.
    ``accountable_user_id`` is the person accountable (default: All's).
    ``specialist_leads`` decides the lead when the department already has one.
    """
    from app.services.audit import record_audit
    from app.services.module_department import adopt_department, set_accountable
    from app.services.module_origin import module_is_installed
    from app.services.module_sources import ensure_platform_seeds

    spec = MODULE_BY_SLUG.get(slug)
    if spec is None:
        raise ValueError(f"Unknown module '{slug}'")
    if spec.status == "coming_soon":
        raise ValueError(f"Module '{slug}' is not available yet")

    if await module_is_installed(session, tenant_id, slug):
        return await _serialize_module_row(session, tenant_id, slug)

    if department_id is not None:
        await adopt_department(session, tenant_id, slug, department_id)
    await ensure_platform_seeds(session, tenant_id, slug)

    hire: dict[str, Any] = {}
    if hire_specialist:
        try:
            hire = await hire_module_agent(
                session,
                tenant_id,
                slug,
                actor_id=actor_id,
                open_setup_chat=False,
            )
        except Exception:  # noqa: BLE001
            logger.warning('module hire payload parse failed', exc_info=True)
            hire = {}

    tags = module_tag_templates(slug)
    auto_tag = None
    if len(tags) == 1:
        try:
            from app.services.tickets import install_tag_template

            auto_tag = await install_tag_template(session, tenant_id, slug, tags[0].slug)
        except Exception:  # noqa: BLE001
            logger.warning("auto tag install for module %s failed", slug, exc_info=True)

    from app.services.module_department import bind_module_department

    agent_raw = hire.get("agent_id")
    try:
        agent_uuid = UUID(str(agent_raw)) if agent_raw else None
    except (ValueError, TypeError):
        agent_uuid = None
    department = await bind_module_department(
        session, tenant_id, slug, agent_id=agent_uuid, specialist_leads=specialist_leads
    )
    await set_accountable(session, tenant_id, department.id, accountable_user_id)
    await session.commit()
    await record_audit(
        session,
        tenant_id,
        action="module:installed",
        actor_type="user" if actor_id else "system",
        actor_id=str(actor_id) if actor_id else "",
        resource_type="module",
        resource_id=slug,
        summary=f"{spec.name} installed",
        after={
            "slug": slug,
            "install_state": "installed",
            "enabled": True,
            "department_id": str(department.id),
        },
    )
    row = await _serialize_module_row(session, tenant_id, slug)
    if hire:
        row["specialist_agent_id"] = hire.get("agent_id")
        row["specialist_agent_name"] = hire.get("agent_name")
        row["hire_action"] = hire.get("action")
    if auto_tag is not None:
        row["auto_tag"] = auto_tag
    row["department_id"] = str(department.id)
    return row


async def hire_module_agent(
    session: AsyncSession,
    tenant_id: UUID,
    slug: str,
    *,
    actor_id: Any = None,
    open_setup_chat: bool = True,
    name: str | None = None,
) -> dict[str, Any]:
    """Create the module specialist once (no patch on existing active agents)."""

    from app.models.auth import Tenant
    from app.models.signal import Signal
    from app.services.managed_resources import ensure_managed_agent
    from app.services.module_agents import add_module_agent, list_module_agents
    from app.services.module_department import bind_module_department
    from app.services.module_origin import get_module_department
    from app.services.ownership import apply_owner
    from app.services.participants import ensure_participant
    from app.services.workforce_runtime import default_tools_for_role

    if slug not in MODULE_BY_SLUG:
        raise ValueError(f"Unknown module: {slug}")
    module = MODULE_BY_SLUG[slug]
    package = get_module_package(slug)
    template = package.agent_template if package else _persona_with_prompt(module)
    tenant = await session.get(Tenant, tenant_id)
    if tenant is None:
        raise ValueError("Tenant not found")

    tools = default_tools_for_role("module_specialist")
    if template and template.extra_tools:
        for tool in template.extra_tools:
            if tool not in tools:
                tools.append(tool)
    prefix = f"{slug}_"
    for verb in (*module.verbs, *module.propose_verbs):
        tool = f"{prefix}{verb}"
        if tool not in tools:
            tools.append(tool)

    fields = {
        "name": (name or template.name or "Agent").strip()[:80] or template.name,
        "slug": f"module-{slug}",
        "role": "assistant",
        "job_title": (template.job_title or template.name or "Agent").strip()[:20],
        "description": template.role_blurb[:280],
        "system_prompt": template.system_prompt,
        "tools": tools,
        "chat_access": "everyone",
    }
    result = await ensure_managed_agent(
        session,
        tenant,
        managed_origin="module",
        managed_ref=slug,
        template_slug=f"module-{slug}",
        display_label=module.name,
        create_fields=fields,
        patch_fields=None,
        match_slugs=[f"module-{slug}"],
    )
    agent = result.agent
    if result.action == "created":
        _apply_persona_avatar(agent, template)
        session.add(agent)
        await session.flush()

    roster = await list_module_agents(session, tenant_id, slug)
    on_roster = any(row.get("agent_id") == str(agent.id) for row in roster)
    if not on_roster and result.action in ("created", "exists", "restore_pending"):
        try:
            await add_module_agent(
                session, tenant_id, slug, agent.id, is_default=True
            )
        except Exception:  # noqa: BLE001
            logger.warning("add module agent for %s failed", slug, exc_info=True)

    dept = await get_module_department(session, tenant_id, slug)
    if dept is not None and result.action in ("created", "exists", "restore_pending"):
        await bind_module_department(session, tenant_id, slug, agent_id=agent.id)

    setup_signal_id: str | None = None
    if open_setup_chat and result.action == "created":
        now = utcnow()
        steps = "\n".join(f"- {s}" for s in module.setup_steps) or "- Finish module setup"
        signal = Signal(
            tenant_id=tenant_id,
            channel="assistant",
            source="module_hire",
            subject=f"Set up {module.name}",
            status="open",
            agent_id=agent.id,
            created_at=now,
            updated_at=now,
            last_message_at=now,
        )
        session.add(signal)
        await session.flush()
        if actor_id:
            try:
                uid = UUID(str(actor_id)) if not isinstance(actor_id, UUID) else actor_id
                await apply_owner(session, signal, "user", uid, by_user_id=uid)
                await ensure_participant(
                    session,
                    signal,
                    kind="user",
                    ref_id=uid,
                    role="owner",
                    joined_via="module_hire",
                )
            except (ValueError, TypeError):
                await apply_owner(session, signal, "agent", agent.id)
        else:
            await apply_owner(session, signal, "agent", agent.id)
        await ensure_participant(
            session,
            signal,
            kind="agent",
            ref_id=agent.id,
            role="member",
            joined_via="module_hire",
        )
        from app.services.chat_runtime import post_message

        await post_message(
            session,
            signal,
            content=(
                f"Hired {agent.name} for {module.name}.\n\n"
                f"Setup checklist:\n{steps}\n\n"
                "Connect the package when ready."
            ),
            role="assistant",
            trust="system",
            author_agent_id=agent.id,
            metadata={"module_hire": True, "module_slug": slug},
        )
        setup_signal_id = str(signal.id)

    await session.commit()

    return {
        "ok": True,
        "action": result.action,
        "agent_id": str(agent.id),
        "agent_name": agent.name,
        "setup_signal_id": setup_signal_id,
        "path": (
            f"/communication/inbox/all/t/{setup_signal_id}"
            if setup_signal_id
            else f"/agents/{agent.id}"
        ),
        "change_id": str(result.change.id) if result.change else None,
    }


async def complete_module_setup(
    session: AsyncSession,
    tenant_id: UUID,
    slug: str,
    *,
    actor_id: Any = None,
) -> dict[str, Any]:
    """Legacy alias: install is already complete after the one-time drop."""
    from app.services.module_origin import module_is_installed

    if await module_is_installed(session, tenant_id, slug):
        return await _serialize_module_row(session, tenant_id, slug)
    return await install_module(session, tenant_id, slug, actor_id=actor_id)


async def uninstall_module(
    session: AsyncSession,
    tenant_id: UUID,
    slug: str,
    *,
    actor_id: Any = None,
) -> dict[str, Any]:
    """De-install = soft-delete the origin department. Connections stay."""
    from app.services.audit import record_audit
    from app.services.module_agents import (
        clear_module_agents,
        soft_archive_module_specialists,
    )
    from app.services.module_department import archive_module_department

    archived = await soft_archive_module_specialists(session, tenant_id, slug)
    kept = await archive_module_department(session, tenant_id, slug, specialist_ids=archived)
    await clear_module_agents(session, tenant_id, slug)
    await record_audit(
        session,
        tenant_id,
        action="module:uninstalled",
        actor_type="user" if actor_id else "system",
        actor_id=str(actor_id) if actor_id else "",
        resource_type="module",
        resource_id=slug,
        summary=f"{MODULE_BY_SLUG[slug].name} uninstalled",
        after={"slug": slug, "install_state": "not_installed", "enabled": False},
    )
    row = await _serialize_module_row(session, tenant_id, slug)
    row["assigned_agent_count"] = 0
    row["default_agent_id"] = None
    row["archived_specialist_ids"] = archived
    row["department_kept"] = kept == "kept"
    return row


def _words(text: str) -> set[str]:
    import re

    return {w for w in re.findall(r"[a-z0-9]+", (text or "").lower()) if len(w) > 2}


async def module_install_plan(session: AsyncSession, tenant_id: UUID, slug: str) -> dict[str, Any]:
    """What adding this module as a department brings, and which department it could join.

    A department overlaps when its name shares a word with the module, or it already
    has a label or flow with a name the module ships. The best overlap is suggested.
    """
    from app.models.agent import Agent
    from app.models.auth import Membership, User
    from app.models.orchestra import Workstream
    from app.models.signal import SignalTag
    from app.services.department_access import department_leads
    from app.services.teams import all_department, list_teams

    spec = MODULE_BY_SLUG.get(slug)
    if spec is None:
        raise ValueError(f"Unknown module '{slug}'")
    package = get_module_package(slug)
    template = package.agent_template if package else _persona_with_prompt(spec)
    tags = [t.name for t in module_tag_templates(slug)]
    flows = [w.name for w in module_workstream_templates(slug)]
    tag_names = {t.lower() for t in tags}
    flow_names = {f.lower() for f in flows}
    module_words = _words(spec.name)

    candidates: list[dict[str, Any]] = []
    for dept in await list_teams(session, tenant_id, include_system=False):
        if dept.origin_module_slug and dept.origin_module_slug != slug:
            continue
        reasons: list[str] = []
        score = 0
        if module_words & _words(dept.name):
            reasons.append("name")
            score += 2
        dept_tags = (
            await session.execute(
                select(SignalTag.name).where(SignalTag.tenant_id == tenant_id, SignalTag.department_id == dept.id)
            )
        ).scalars().all()
        if tag_names & {n.lower() for n in dept_tags}:
            reasons.append("labels")
            score += 1
        dept_flows = (
            await session.execute(
                select(Workstream.name).where(
                    Workstream.tenant_id == tenant_id,
                    Workstream.department_id == dept.id,
                    Workstream.deleted_at.is_(None),
                )
            )
        ).scalars().all()
        if flow_names & {n.lower() for n in dept_flows}:
            reasons.append("flows")
            score += 1
        leads = await department_leads(session, tenant_id, dept.id)
        lead = await session.get(Agent, leads["lead_agent_id"]) if leads["lead_agent_id"] else None
        candidates.append({
            "id": str(dept.id),
            "name": dept.name,
            "overlap": reasons,
            "score": score,
            "lead_name": lead.name if lead else None,
        })
    candidates.sort(key=lambda c: (-c["score"], c["name"].lower()))
    suggested = next((c["id"] for c in candidates if c["score"] > 0), None)

    root = await all_department(session, tenant_id)
    root_accountable = (await department_leads(session, tenant_id, root.id))["accountable_user_id"]
    people = [
        {"id": str(u.id), "name": u.display_name or u.email}
        for u in (
            await session.execute(
                select(User)
                .join(Membership, Membership.user_id == User.id)
                .where(Membership.tenant_id == tenant_id, User.is_active.is_(True))
                .order_by(User.display_name)
            )
        ).scalars().all()
    ]
    return {
        "slug": slug,
        "name": spec.name,
        "ships": {
            "specialist": template.name if template else None,
            "labels": tags,
            "flows": flows,
            "folder": bool(package and package.project),
        },
        "candidates": candidates,
        "suggested_department_id": suggested,
        "default_accountable_user_id": str(root_accountable) if root_accountable else None,
        "people": people,
    }


async def enable_module_for_provider(
    session: AsyncSession, tenant_id: UUID, provider_slug: str
) -> None:
    """Package connect does not install the module (one-time drop is explicit)."""
    del session, tenant_id, provider_slug


async def get_module_prefs(
    session: AsyncSession, tenant_id: UUID, slug: str
) -> dict[str, Any]:
    from app.services.module_origin import get_module_department, module_prefs_from_department

    return module_prefs_from_department(
        await get_module_department(session, tenant_id, slug)
    )


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
    customer_tools: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Persist operator defaults on the origin department settings_json.modules."""
    if MODULE_BY_SLUG.get(slug) is None:
        raise ValueError(f"Unknown module '{slug}'")
    from app.services.module_department import ensure_module_department
    from app.services.module_origin import (
        get_module_department,
        module_prefs_from_department,
        write_module_prefs_to_department,
    )
    from app.services.setup_links import replace_resource_grants

    department = await get_module_department(session, tenant_id, slug)
    if department is None:
        department = await ensure_module_department(session, tenant_id, slug)

    updates: dict[str, Any] = {}
    prefs_now = module_prefs_from_department(department)
    if clear_default_connection:
        updates["default_connection_id"] = None
    elif default_connection_id is not None:
        updates["default_connection_id"] = str(default_connection_id).strip() or None
    if default_company_by_connection is not None:
        merged = dict(prefs_now.get("default_company_by_connection") or {})
        for key, value in default_company_by_connection.items():
            cid = str(key).strip()
            company = str(value or "").strip()
            if not cid:
                continue
            if company:
                merged[cid] = company
            else:
                merged.pop(cid, None)
        updates["default_company_by_connection"] = merged
    if writes_enabled is not None:
        updates["writes_enabled"] = bool(writes_enabled)
    if user_access is not None:
        mode = str(user_access.get("mode") or "all_members")
        if mode not in ("all_members", "selected"):
            mode = "all_members"
        user_ids = [str(u) for u in (user_access.get("user_ids") or []) if str(u).strip()]
        updates["user_access"] = {"mode": mode, "user_ids": user_ids}
    if customer_tools is not None:
        updates["customer_tools"] = {
            str(k).strip(): bool(v)
            for k, v in customer_tools.items()
            if str(k).strip()
        }
    prefs = write_module_prefs_to_department(department, updates)
    session.add(department)
    await session.flush()
    if user_access is not None:
        saved = prefs.get("user_access") or {}
        mode = str(saved.get("mode") or "all_members")
        user_ids = [str(item) for item in (saved.get("user_ids") or [])]
        grant_entries = (
            [{"kind": "department", "id": "everyone", "level": "use"}]
            if mode != "selected"
            else [{"kind": "user", "id": user_id, "level": "use"} for user_id in user_ids]
        )
        await replace_resource_grants(
            session, tenant_id, "module", grant_entries, module_slug=slug
        )
    await session.commit()
    await session.refresh(department)
    return module_prefs_from_department(department)


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
        f"set_connection_scope, list_module_sources, propose_module_source.\n"
        f"If this work comes up, call recommend_module with slug `{module.slug}` "
        f"instead of guessing a vendor. Prefer the managed specialist "
        f"(list_modules → specialist_agent_id): ask_agent or handoff_to; "
        f"do not run {module.slug}_* tools yourself "
        f"unless you are that specialist.\n"
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
