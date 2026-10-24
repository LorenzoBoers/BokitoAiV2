import type { LucideIcon } from 'lucide-react'
import {
  BookOpen,
  Briefcase,
  Calculator,
  FileText,
  Landmark,
  TrendingUp,
} from 'lucide-react'
import type { IntegrationModuleRow, ModuleToolCard } from './integrations-api'

export type { IntegrationModuleRow, ModuleToolCard }

const ACCOUNTING_TOOL_CARDS: ModuleToolCard[] = [
  {
    verb: 'list_companies',
    label: 'Administrations',
    description: 'List every administration (company file) available on connected packages.',
    kind: 'read',
  },
  {
    verb: 'get_company',
    label: 'Administration detail',
    description: 'Fetch one administration by id: name, currency, and package metadata.',
    kind: 'read',
  },
  {
    verb: 'search_parties',
    label: 'Search contacts',
    description: 'Search customers and suppliers by name, email, or chamber-of-commerce id.',
    kind: 'read',
  },
  {
    verb: 'get_party',
    label: 'Contact detail',
    description: 'Open one contact or supplier with addresses and payment details.',
    kind: 'read',
  },
  {
    verb: 'list_documents',
    label: 'List invoices and bills',
    description: 'List sales invoices and purchase bills, optionally filtered by status or party.',
    kind: 'read',
  },
  {
    verb: 'get_document',
    label: 'Invoice or bill detail',
    description: 'Fetch one invoice or bill including lines, totals, and payment state.',
    kind: 'read',
  },
  {
    verb: 'list_accounts',
    label: 'Chart of accounts',
    description: 'List ledger accounts (GL codes) used for booking.',
    kind: 'read',
  },
  {
    verb: 'get_account',
    label: 'Account detail',
    description: 'Fetch one ledger account with type and balance when the package provides it.',
    kind: 'read',
  },
  {
    verb: 'list_ledger',
    label: 'Ledger entries',
    description: 'List journal or ledger lines for a period or account.',
    kind: 'read',
  },
  {
    verb: 'list_outstanding',
    label: 'Outstanding balances',
    description: 'List open receivable and payable amounts per party or document.',
    kind: 'read',
  },
  {
    verb: 'list_bank_mutations',
    label: 'Bank mutations',
    description: 'List imported bank transactions waiting to be matched or booked.',
    kind: 'read',
  },
  {
    verb: 'summarize',
    label: 'Summary',
    description: 'Produce a short financial snapshot (open items, recent documents) for the agent.',
    kind: 'read',
  },
  {
    verb: 'vat_rates',
    label: 'VAT rates',
    description: 'Statutory Dutch VAT rates. Computes VAT only when the rate and the net amount are passed.',
    kind: 'read',
  },
  {
    verb: 'invoice_check',
    label: 'Invoice check',
    description: 'Which invoice mentions are still missing. A simplified invoice is only up to €100 including VAT.',
    kind: 'read',
  },
  {
    verb: 'payment_terms',
    label: 'Payment term',
    description: 'Statutory payment term. Does not calculate interest.',
    kind: 'read',
  },
  {
    verb: 'propose_document',
    label: 'Propose invoice or bill',
    description: 'Draft a sales or purchase document; creates a decision before anything is written.',
    kind: 'propose',
  },
  {
    verb: 'propose_party',
    label: 'Propose contact',
    description: 'Draft a new or updated customer/supplier; requires human approval to apply.',
    kind: 'propose',
  },
  {
    verb: 'propose_booking',
    label: 'Propose booking',
    description: 'Draft a journal booking; applied only after you approve the decision.',
    kind: 'propose',
  },
  {
    verb: 'propose_match',
    label: 'Propose payment match',
    description: 'Propose matching a bank mutation to an open document.',
    kind: 'propose',
  },
  {
    verb: 'propose_send',
    label: 'Propose send invoice',
    description: 'Propose sending an invoice from the package; waits for your approval.',
    kind: 'propose',
  },
]

/** Shown while the catalog API is unreachable so module sections still render. */
export const FALLBACK_MODULES: IntegrationModuleRow[] = [
  {
    slug: 'accounting',
    name: 'Accounting',
    description:
      'One accounting contract for agents: companies, parties, invoices, ledger, and outstanding balances across every connected package.',
    status: 'available',
    provider_slugs: ['king_accountancy', 'bjorn_lunden_mcp', 'moneybird'],
    planned_provider_slugs: ['exact_online', 'snelstart'],
    tool_cards: ACCOUNTING_TOOL_CARDS,
    verbs: ACCOUNTING_TOOL_CARDS.filter((c) => c.kind === 'read').map((c) => c.verb),
    propose_verbs: ACCOUNTING_TOOL_CARDS.filter((c) => c.kind === 'propose').map((c) => c.verb),
    verb_labels: ACCOUNTING_TOOL_CARDS.filter((c) => c.kind === 'read').map((c) => c.label),
    needs_when: 'invoices, VAT, ledgers, outstanding balances, or bookkeeping',
    setup_steps: [
      'Install Accounting under Settings > Modules.',
      'Optionally enable a platform integration this module can use (KING, Bjorn Lunden, or Moneybird).',
      'If more than one administration appears, pick which one agents should use.',
      'Finish setup to mark the module installed.',
    ],
    capability_summary:
      'Agents can list administrations, contacts, invoices, ledger lines, and outstanding balances.',
    setup_path: '/connections/accounting',
    workspace_path: '/connections/accounting',
    enabled: false,
    install_state: 'not_installed',
    tenant_status: 'not_installed',
  },
  {
    slug: 'banking',
    name: 'Banking',
    description:
      'Read bank accounts, balances, and transactions. Check an IBAN and a payment checklist. A proposal does not send a transfer.',
    status: 'available',
    provider_slugs: ['gocardless_bank'],
    planned_provider_slugs: ['tink', 'yapily', 'knab'],
    tool_cards: [
      { verb: 'list_accounts', label: 'Accounts', description: 'List linked bank accounts.', kind: 'read' },
      { verb: 'get_balance', label: 'Balances', description: 'Read current balances.', kind: 'read' },
      {
        verb: 'list_transactions',
        label: 'Transactions',
        description: 'List recent bank transactions.',
        kind: 'read',
      },
      { verb: 'iban_check', label: 'IBAN check', description: 'Check the IBAN check digits.', kind: 'read' },
      { verb: 'consent', label: 'Account consent', description: 'How long account-information consent lasts.', kind: 'read' },
      { verb: 'liquidity', label: 'Cash position', description: 'Sum balances already read, per currency.', kind: 'read' },
      { verb: 'payment_guard', label: 'Payment checklist', description: 'Fields a payment proposal still needs.', kind: 'read' },
      {
        verb: 'propose_payment',
        label: 'Propose payment',
        description: 'Draft an outgoing payment that only runs after you approve. Does not send it.',
        kind: 'propose',
      },
    ],
    verb_labels: ['Accounts', 'Balances', 'Transactions', 'IBAN check', 'Account consent', 'Cash position', 'Payment checklist'],
    needs_when: 'bank balances, transactions, or outgoing payments',
    setup_steps: [
      'Install Banking under Settings > Connections.',
      'Connect a PSD2 provider to read accounts. The checklist works before a bank is linked.',
      'Payments stay a proposal you approve.',
    ],
    capability_summary: 'Reads accounts, balances, and transactions. Does not send a transfer.',
    setup_path: '/connections/banking',
    workspace_path: '/connections/banking',
    enabled: false,
    install_state: 'not_installed',
    tenant_status: 'not_installed',
  },
  {
    slug: 'investing',
    name: 'Investing',
    description:
      'Keeps an order the operator already chose inside the advice boundary. No broker is connected, so there is no live quote and no execution.',
    status: 'available',
    provider_slugs: [],
    planned_provider_slugs: ['twelve_data', 'alpaca', 'bitvavo', 'tradingview_alerts'],
    tool_cards: [
      { verb: 'advice_boundary', label: 'Advice boundary', description: 'Refuse a personal recommendation of a specific instrument.', kind: 'read' },
      { verb: 'order_ticket', label: 'Order ticket', description: 'Fields an order proposal still needs.', kind: 'read' },
      { verb: 'concentration', label: 'Position weights', description: 'Share of each position in a total you pass.', kind: 'read' },
      { verb: 'get_positions', label: 'Positions', description: 'List open positions once a broker is connected.', kind: 'read' },
      { verb: 'get_quotes', label: 'Quotes', description: 'Fetch quotes once a price feed is connected.', kind: 'read' },
      { verb: 'list_watchlist', label: 'Watchlists', description: 'List tracked symbols once a broker is connected.', kind: 'read' },
      {
        verb: 'propose_order',
        label: 'Propose order',
        description: 'Record the order the operator already chose. Nothing is sent to a broker.',
        kind: 'propose',
      },
    ],
    verb_labels: ['Advice boundary', 'Order ticket', 'Position weights'],
    needs_when: 'an order the operator already chose, or a question that would be investment advice',
    setup_steps: [
      'Install Investing under Settings > Connections.',
      'This module adds no broker login. Quotes and positions wait for a broker.',
      'Investo does not recommend an instrument. Orders stay a proposal you approve.',
    ],
    capability_summary: 'Keeps the advice boundary and an order ticket. Does not quote a price or send an order.',
    setup_path: '/connections/investing',
    workspace_path: '/connections/investing',
    enabled: false,
    install_state: 'not_installed',
    tenant_status: 'not_installed',
  },
  {
    slug: 'documents',
    name: 'Documents',
    description:
      'Read files from connected storage, state how long a record is kept, and cite only what was read. Uploads stay a proposal.',
    status: 'available',
    provider_slugs: ['google_drive'],
    planned_provider_slugs: ['microsoft_graph_files', 'dropbox'],
    tool_cards: [
      { verb: 'search', label: 'Search files', description: 'Search files on the connected Google Drive.', kind: 'read' },
      { verb: 'list', label: 'List files', description: 'List files in a Drive folder.', kind: 'read' },
      { verb: 'get_content', label: 'Read content', description: 'Read a file so the agent can cite it.', kind: 'read' },
      { verb: 'sheets_read', label: 'Read sheet', description: 'Read cell values from a Google Sheet range.', kind: 'read' },
      { verb: 'retention', label: 'Retention', description: 'How long to keep the file.', kind: 'read' },
      { verb: 'classify', label: 'Classify file', description: 'Which specialist owns the next step.', kind: 'read' },
      { verb: 'cite', label: 'Cite a file', description: 'Cite a title, file id, and quote already read.', kind: 'read' },
      {
        verb: 'propose_upload',
        label: 'Propose upload',
        description: 'Propose uploading a file after approval.',
        kind: 'propose',
      },
    ],
    verb_labels: ['Search files', 'List files', 'Read content', 'Read sheet', 'Retention', 'Classify file', 'Cite a file'],
    needs_when: 'files in Drive, a Google Sheet, or how long a record must be kept',
    setup_steps: [
      'Install Documents under Settings > Connections.',
      'Connect Google Drive when agents should search files. Retention works before Drive is linked.',
      'Uploads and sheet writes stay a proposal you approve.',
    ],
    capability_summary: 'Searches and reads Drive files and Sheets, and states how long a record is kept.',
    setup_path: '/connections/documents',
    workspace_path: '/connections/documents',
    enabled: false,
    install_state: 'not_installed',
    tenant_status: 'not_installed',
  },
  {
    slug: 'accountant',
    name: 'Accountant',
    description:
      'Prepares the year file: size class, tie-outs, estimates, the commercial-to-tax bridge, and filing dates. It does not keep the books and it does not add a package login.',
    status: 'available',
    provider_slugs: [],
    planned_provider_slugs: [],
    tool_cards: [
      { verb: 'engagement', label: 'Assignment', description: 'Compilation, tax position, or advice. A review or audit is refused.', kind: 'read' },
      { verb: 'size_class', label: 'Size class', description: 'Micro, small, medium, or large from assets, turnover, and employees.', kind: 'read' },
      { verb: 'filing_calendar', label: 'Filing dates', description: 'Preparation, deposit, and tax dates. Does not file.', kind: 'read' },
      { verb: 'tie_outs', label: 'Tie-outs', description: 'Questions that tie subledgers to the ledger.', kind: 'read' },
      { verb: 'estimates', label: 'Estimates', description: 'Policies, provisions, accruals, and going concern.', kind: 'read' },
      { verb: 'tax_bridge', label: 'Tax bridge', description: 'Commercial profit to an indicative fiscal result.', kind: 'read' },
      { verb: 'statements_outline', label: 'Statements outline', description: 'Which statements the size class requires.', kind: 'read' },
      { verb: 'plausibility', label: 'Plausibility', description: 'Questions on margin, VAT, cutoff, and unusual journals.', kind: 'read' },
      { verb: 'propose_findings', label: 'Propose findings', description: 'Record findings. Bookings stay with Accounting.', kind: 'propose' },
      { verb: 'propose_appropriation', label: 'Propose appropriation', description: 'Propose the result appropriation. Nothing is booked.', kind: 'propose' },
      { verb: 'propose_compilation', label: 'Propose compilation pack', description: 'Mark the pack ready. Does not sign or file.', kind: 'propose' },
      { verb: 'request_dossier', label: 'Request year-file documents', description: 'Ask for the year-file documents still missing.', kind: 'propose' },
    ],
    verb_labels: ['Assignment', 'Size class', 'Filing dates', 'Tie-outs', 'Estimates', 'Tax bridge', 'Statements outline', 'Plausibility'],
    needs_when: 'annual accounts, size class, tax position, or filing dates',
    setup_steps: [
      'Install Accountant under Settings > Connections.',
      'Install Accounting as well when the year file needs live figures. This module adds no package login.',
      'Bookings, invoices, and bank matching stay with Accounting and Banking.',
    ],
    capability_summary:
      'Prepares the year file. Does not book, match the bank, file, or sign a report.',
    setup_path: '/connections/accountant',
    workspace_path: '/connections/accountant',
    enabled: false,
    install_state: 'not_installed',
    tenant_status: 'not_installed',
  },
]

const PLANNED_PROVIDER_LABELS: Record<string, string> = {
  exact_online: 'Exact Online',
  snelstart: 'SnelStart',
  gocardless_bank: 'GoCardless',
  tink: 'Tink',
  yapily: 'Yapily',
  knab: 'Knab',
  twelve_data: 'Twelve Data',
  alpaca: 'Alpaca',
  bitvavo: 'Bitvavo',
  tradingview_alerts: 'TradingView alerts',
  google_drive: 'Google Drive',
  microsoft_graph_files: 'Microsoft OneDrive / SharePoint',
  dropbox: 'Dropbox',
}

export function plannedProviderLabel(slug: string): string {
  return PLANNED_PROVIDER_LABELS[slug] ?? slug.replace(/_/g, ' ')
}

/** Sidebar / rail icon per module slug (catalog Modules tab stays Boxes). */
const MODULE_NAV_ICONS: Record<string, LucideIcon> = {
  accounting: Calculator,
  banking: Landmark,
  investing: TrendingUp,
  documents: FileText,
  accountant: Briefcase,
}

export function moduleNavIcon(slug: string): LucideIcon {
  return MODULE_NAV_ICONS[slug] ?? BookOpen
}

/** Resolve tool cards from API or legacy verb_labels / verbs arrays. */
export function resolveModuleToolCards(
  module: Pick<IntegrationModuleRow, 'slug' | 'tool_cards' | 'verbs' | 'propose_verbs' | 'verb_labels'>,
): ModuleToolCard[] {
  if (module.tool_cards && module.tool_cards.length > 0) return module.tool_cards
  const reads = (module.verbs ?? []).map((verb, i) => ({
    verb,
    label: module.verb_labels?.[i] ?? verb,
    description: '',
    kind: 'read' as const,
  }))
  const proposes = (module.propose_verbs ?? []).map((verb) => ({
    verb,
    label: verb,
    description: '',
    kind: 'propose' as const,
  }))
  return [...reads, ...proposes]
}

export function moduleToolPath(moduleSlug: string, verb: string): string {
  if (verb.startsWith(`${moduleSlug}_`)) return verb
  return `${moduleSlug}_${verb}`
}

/** i18n key fragment for a catalog verb label, e.g. "Invoices and bills" → "invoices_and_bills". */
export function verbLabelKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

export function moduleHomePath(module: Pick<IntegrationModuleRow, 'slug' | 'setup_path'>): string {
  const path = module.setup_path?.trim()
  if (path?.startsWith('/connections/')) return path
  // Rows seeded before the hub moved still carry the old hub prefixes.
  if (path?.startsWith('/modules/')) return path.replace('/modules/', '/connections/')
  if (path?.startsWith('/settings/modules/')) {
    return path.replace('/settings/modules/', '/connections/')
  }
  return `/connections/${encodeURIComponent(module.slug)}`
}

export function moduleWorkspacePath(
  module: Pick<IntegrationModuleRow, 'slug' | 'workspace_path' | 'setup_path'>,
): string {
  // Single module page: workspace and setup share `/connections/:slug`.
  return moduleHomePath(module)
}

export function moduleInstallState(
  module: Pick<IntegrationModuleRow, 'install_state' | 'enabled' | 'tenant_status' | 'status'>,
): 'not_installed' | 'setup' | 'installed' | 'coming_soon' {
  if (module.status === 'coming_soon' || module.tenant_status === 'coming_soon') return 'coming_soon'
  if (module.install_state === 'setup' || module.tenant_status === 'setup') return 'setup'
  if (module.install_state === 'installed') return 'installed'
  if (module.install_state === 'not_installed') return 'not_installed'
  if (typeof module.enabled === 'boolean') {
    return module.enabled ? 'installed' : 'not_installed'
  }
  if (
    module.tenant_status === 'installed' ||
    module.tenant_status === 'connected' ||
    module.tenant_status === 'on'
  ) {
    return 'installed'
  }
  return 'not_installed'
}

/** True when the module is installed (tools + AI nav). Setup alone is not enough. */
export function moduleIsOn(
  module: Pick<IntegrationModuleRow, 'enabled' | 'tenant_status' | 'install_state' | 'status'>,
): boolean {
  return moduleInstallState(module) === 'installed'
}

export function moduleIsInSetup(
  module: Pick<IntegrationModuleRow, 'install_state' | 'tenant_status' | 'status'>,
): boolean {
  return moduleInstallState(module) === 'setup'
}

export function moduleStatusLabelKey(
  module: Pick<
    IntegrationModuleRow,
    'status' | 'tenant_status' | 'connected' | 'enabled' | 'install_state'
  >,
):
  | 'comingSoon'
  | 'connectedBadge'
  | 'installedBadge'
  | 'setupBadge'
  | 'notInstalledBadge'
  | 'onBadge'
  | 'offBadge' {
  const state = moduleInstallState(module)
  if (state === 'coming_soon') return 'comingSoon'
  if (state === 'setup') return 'setupBadge'
  if (state === 'installed') {
    if (module.tenant_status === 'connected' || module.connected) return 'connectedBadge'
    return 'installedBadge'
  }
  return 'notInstalledBadge'
}
