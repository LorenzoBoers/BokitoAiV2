import type { LucideIcon } from 'lucide-react'
import {
  BookOpen,
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
    setup_path: '/modules/accounting',
    workspace_path: '/modules/accounting',
    enabled: false,
    install_state: 'not_installed',
    tenant_status: 'not_installed',
  },
  {
    slug: 'banking',
    name: 'Banking',
    description:
      'PSD2 / open-banking reads (accounts, balances, transactions); payments only as a proposal that a human approves.',
    status: 'coming_soon',
    provider_slugs: [],
    planned_provider_slugs: ['gocardless_bank', 'tink', 'yapily', 'knab'],
    tool_cards: [
      { verb: 'list_accounts', label: 'Accounts', description: 'List linked bank accounts.', kind: 'read' },
      { verb: 'get_balance', label: 'Balances', description: 'Read current balances.', kind: 'read' },
      {
        verb: 'list_transactions',
        label: 'Transactions',
        description: 'List recent bank transactions.',
        kind: 'read',
      },
      {
        verb: 'propose_payment',
        label: 'Propose payment',
        description: 'Draft an outgoing payment that only runs after you approve.',
        kind: 'propose',
      },
    ],
    verb_labels: ['Accounts', 'Balances', 'Transactions'],
    needs_when: 'bank balances, transactions, or outgoing payments',
    setup_steps: [
      'This module is prepared but not connectable yet.',
      'When a bank connector ships, you will pick it here and approve payments as decisions.',
    ],
    capability_summary: 'Later: read accounts, balances, and transactions.',
    setup_path: '/modules/banking',
    workspace_path: '/modules/banking',
    enabled: false,
    install_state: 'not_installed',
    tenant_status: 'coming_soon',
  },
  {
    slug: 'investing',
    name: 'Investing',
    description:
      'Market data, positions, and watchlists; TradingView webhook alerts land as Signals. Orders only as a proposal that a human approves.',
    status: 'coming_soon',
    provider_slugs: [],
    planned_provider_slugs: ['twelve_data', 'alpaca', 'bitvavo', 'tradingview_alerts'],
    tool_cards: [
      { verb: 'get_positions', label: 'Positions', description: 'List open positions.', kind: 'read' },
      { verb: 'get_quotes', label: 'Quotes', description: 'Fetch quotes for watchlist symbols.', kind: 'read' },
      { verb: 'list_watchlist', label: 'Watchlists', description: 'List tracked symbols.', kind: 'read' },
      {
        verb: 'propose_order',
        label: 'Propose order',
        description: 'Draft a trade order; execution waits for approval.',
        kind: 'propose',
      },
    ],
    verb_labels: ['Positions', 'Quotes', 'Watchlists'],
    needs_when: 'positions, quotes, watchlists, or trade orders',
    setup_steps: [
      'This module is prepared but not connectable yet.',
      'When a broker or market-data connector ships, orders will land as decisions.',
    ],
    capability_summary: 'Later: positions, quotes, and watchlists.',
    setup_path: '/modules/investing',
    workspace_path: '/modules/investing',
    enabled: false,
    install_state: 'not_installed',
    tenant_status: 'coming_soon',
  },
  {
    slug: 'documents',
    name: 'Documents',
    description:
      'Bridge to external document storage. Read content flows into the existing workspace knowledge stack; uploads only as a proposal.',
    status: 'coming_soon',
    provider_slugs: [],
    planned_provider_slugs: ['google_drive', 'microsoft_graph_files', 'dropbox'],
    tool_cards: [
      { verb: 'search', label: 'Search files', description: 'Search external storage.', kind: 'read' },
      { verb: 'list', label: 'List files', description: 'List files in a folder.', kind: 'read' },
      { verb: 'get_content', label: 'Read content', description: 'Read file content into Knowledge.', kind: 'read' },
      {
        verb: 'propose_upload',
        label: 'Propose upload',
        description: 'Propose uploading a file after approval.',
        kind: 'propose',
      },
    ],
    verb_labels: ['Search files', 'List files', 'Read content'],
    needs_when: 'files that live in Drive, SharePoint, or Dropbox',
    setup_steps: [
      'This module is prepared but not connectable yet.',
      'When a storage connector ships, reads feed Knowledge and uploads stay decisions.',
    ],
    capability_summary: 'Later: search and read external files into Knowledge.',
    setup_path: '/modules/documents',
    workspace_path: '/modules/documents',
    enabled: false,
    install_state: 'not_installed',
    tenant_status: 'coming_soon',
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
  if (path?.startsWith('/modules/')) return path
  if (path?.startsWith('/settings/modules/')) {
    return path.replace('/settings/modules/', '/modules/')
  }
  return `/modules/${encodeURIComponent(module.slug)}`
}

export function moduleWorkspacePath(
  module: Pick<IntegrationModuleRow, 'slug' | 'workspace_path' | 'setup_path'>,
): string {
  // Single module page: workspace and setup share `/modules/:slug`.
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
