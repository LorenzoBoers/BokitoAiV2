import type { IntegrationModuleRow } from './integrations-api'

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
    verb_labels: [
      'Administrations',
      'Contacts',
      'Invoices and bills',
      'Chart of accounts',
      'Ledger',
      'Outstanding balances',
      'Bank mutations',
      'Summary',
    ],
    needs_when: 'invoices, VAT, ledgers, outstanding balances, or bookkeeping',
    setup_steps: [
      'Open the Accounting module page.',
      'Choose a package (KING, Bjorn Lunden, or Moneybird).',
      'Connect with OAuth or an API key.',
      'If more than one administration appears, pick which one agents should use.',
    ],
    capability_summary:
      'Agents can list administrations, contacts, invoices, ledger lines, and outstanding balances. Writes always become a decision you approve.',
    setup_path: '/settings/modules/accounting',
    tenant_status: 'available',
  },
  {
    slug: 'banking',
    name: 'Banking',
    description:
      'PSD2 / open-banking reads (accounts, balances, transactions); payments only as a proposal that a human approves.',
    status: 'coming_soon',
    provider_slugs: [],
    planned_provider_slugs: ['gocardless_bank', 'tink', 'yapily', 'knab'],
    verb_labels: ['Accounts', 'Balances', 'Transactions'],
    needs_when: 'bank balances, transactions, or outgoing payments',
    setup_steps: [
      'This module is prepared but not connectable yet.',
      'When a bank connector ships, you will pick it here and approve payments as decisions.',
    ],
    capability_summary:
      'Later: read accounts, balances, and transactions. Payments stay a human-approved proposal.',
    setup_path: '/settings/modules/banking',
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
    verb_labels: ['Positions', 'Quotes', 'Watchlists'],
    needs_when: 'positions, quotes, watchlists, or trade orders',
    setup_steps: [
      'This module is prepared but not connectable yet.',
      'When a broker or market-data connector ships, orders will land as decisions.',
    ],
    capability_summary:
      'Later: positions, quotes, and watchlists. Orders stay a human-approved proposal.',
    setup_path: '/settings/modules/investing',
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
    verb_labels: ['Search files', 'List files', 'Read content'],
    needs_when: 'files that live in Drive, SharePoint, or Dropbox',
    setup_steps: [
      'This module is prepared but not connectable yet.',
      'When a storage connector ships, reads feed Knowledge and uploads stay decisions.',
    ],
    capability_summary:
      'Later: search and read external files into Knowledge. Uploads stay a human-approved proposal.',
    setup_path: '/settings/modules/documents',
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

export function moduleHomePath(module: Pick<IntegrationModuleRow, 'slug' | 'setup_path'>): string {
  return module.setup_path?.trim() || `/settings/modules/${encodeURIComponent(module.slug)}`
}
