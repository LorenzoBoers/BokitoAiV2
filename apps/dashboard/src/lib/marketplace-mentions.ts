/**
 * Catalog names that agents should chip inline and showcase as cards.
 * Used live (while streaming) and on saved bubbles when attach_items was skipped.
 */
import { REMOTE_MCP_HOSTS } from './mcp-remote-providers'
import type { ProposalItem } from './inbox-api'

const SKIP_BARE = new Set(['google', 'microsoft', 'custom', 'custom tool', 'custom mcp'])

const CORE_NAMES: Array<{ slug: string; names: string[] }> = [
  { slug: 'github', names: ['GitHub'] },
  { slug: 'slack', names: ['Slack'] },
  { slug: 'notion', names: ['Notion'] },
  { slug: 'linear', names: ['Linear'] },
  { slug: 'asana', names: ['Asana'] },
  { slug: 'clickup', names: ['ClickUp'] },
  { slug: 'sentry', names: ['Sentry'] },
  { slug: 'stripe', names: ['Stripe'] },
  { slug: 'shopify', names: ['Shopify'] },
  { slug: 'whatsapp', names: ['WhatsApp'] },
  { slug: 'king_accountancy', names: ['KING Accountancy', 'KING'] },
  { slug: 'moneybird', names: ['Moneybird'] },
  { slug: 'exact', names: ['Exact Online'] },
  { slug: 'snelstart', names: ['SnelStart'] },
  { slug: 'gocardless', names: ['GoCardless Bank Account Data', 'GoCardless BankAccountData', 'GoCardless'] },
  { slug: 'tink', names: ['Tink'] },
  { slug: 'yapily', names: ['Yapily'] },
  { slug: 'knab', names: ['Knab'] },
  { slug: 'google_calendar', names: ['Google Calendar'] },
  { slug: 'google_drive', names: ['Google Drive'] },
  { slug: 'outlook', names: ['Microsoft 365', 'Outlook'] },
  { slug: 'onedrive', names: ['OneDrive', 'SharePoint'] },
  { slug: 'dropbox', names: ['Dropbox'] },
  { slug: 'bitvavo', names: ['Bitvavo'] },
  { slug: 'tradingview', names: ['TradingView'] },
  { slug: 'twelve_data', names: ['Twelve Data'] },
]

export type MarketplaceMention = { name: string; slug: string; title: string }

let cachedIndex: MarketplaceMention[] | null = null

function addName(
  map: Map<string, { slug: string; title: string }>,
  raw: string,
  slug: string,
  title: string,
) {
  const name = raw.trim().toLowerCase().replace(/\s+/g, ' ')
  if (name.length < 3 || SKIP_BARE.has(name)) return
  const prev = map.get(name)
  if (!prev || name.length >= prev.slug.length) map.set(name, { slug, title })
}

export function marketplaceMentionIndex(): MarketplaceMention[] {
  if (cachedIndex) return cachedIndex
  const map = new Map<string, { slug: string; title: string }>()
  for (const row of CORE_NAMES) {
    for (const label of row.names) addName(map, label, row.slug, row.names[0] || label)
  }
  for (const host of REMOTE_MCP_HOSTS) {
    const title = host.name || host.slug
    addName(map, title, host.slug, title)
    addName(map, host.slug.replace(/_/g, ' '), host.slug, title)
  }
  cachedIndex = [...map.entries()]
    .map(([name, row]) => ({ name, slug: row.slug, title: row.title }))
    .sort((a, b) => b.name.length - a.name.length)
  return cachedIndex
}

function isWordChar(ch: string): boolean {
  return /[\p{L}\p{N}_]/u.test(ch)
}

export function isMentionBoundary(text: string, start: number, end: number): boolean {
  if (start > 0 && isWordChar(text[start - 1] || '')) return false
  if (end < text.length && isWordChar(text[end] || '')) return false
  return true
}

/** Short catalog names only chip when written as a proper name, not "exact"/"bol". */
export function isSafeMentionSlice(slice: string): boolean {
  if (slice.length >= 6 || /\s/.test(slice)) return true
  const first = slice[0] || ''
  return first !== first.toLowerCase()
}

export function marketplaceConnectPath(slug: string): string {
  return `/connections?connect=${encodeURIComponent(slug)}`
}

function itemFromMention(slug: string, title: string): ProposalItem {
  return {
    type: 'marketplace',
    id: slug,
    title,
    subtitle: '',
    provider: slug,
    path: marketplaceConnectPath(slug),
  }
}

function isProposalItem(value: unknown): value is ProposalItem {
  if (!value || typeof value !== 'object') return false
  const row = value as ProposalItem
  return Boolean(row.type && (row.id || row.provider || row.slug))
}

export function itemsFromAttachResult(result: unknown): ProposalItem[] {
  if (!result) return []
  let parsed: unknown = result
  if (typeof result === 'string') {
    try {
      parsed = JSON.parse(result)
    } catch {
      return []
    }
  }
  if (!parsed || typeof parsed !== 'object') return []
  const rows = (parsed as { items?: unknown }).items
  if (!Array.isArray(rows)) return []
  return rows.filter(isProposalItem)
}

export function inferMarketplaceItems(text: string): ProposalItem[] {
  const body = text || ''
  if (!body.trim()) return []
  const lower = body.toLowerCase()
  const hits: Array<{ start: number; slug: string; title: string }> = []
  const seen = new Set<string>()
  for (const mention of marketplaceMentionIndex()) {
    if (seen.has(mention.slug)) continue
    let from = 0
    while (from < lower.length) {
      const at = lower.indexOf(mention.name, from)
      if (at < 0) break
      const end = at + mention.name.length
      if (isMentionBoundary(body, at, end) && isSafeMentionSlice(body.slice(at, end))) {
        seen.add(mention.slug)
        hits.push({ start: at, slug: mention.slug, title: mention.title })
        break
      }
      from = end
    }
  }
  hits.sort((a, b) => a.start - b.start)
  return hits.slice(0, 10).map((hit) => itemFromMention(hit.slug, hit.title))
}

function showcaseKey(item: ProposalItem): string {
  if (item.type === 'marketplace' || item.type === 'integration') {
    const title = (item.title || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/\s*\/\s*.+$/, '')
      .trim()
    if (title) return `connector-title:${title}`
    const raw = String(item.provider || item.id || item.slug || '')
      .toLowerCase()
      .replace(/(_mcp|_bank|_online|_accountancy)$/, '')
    return `connector:${raw}`
  }
  return `${item.type}:${item.id || item.slug || ''}`
}

export function mergeShowcaseItems(
  attached: ProposalItem[] | null | undefined,
  inferred: ProposalItem[],
): ProposalItem[] {
  const out: ProposalItem[] = []
  const seen = new Set<string>()
  const take = (item: ProposalItem) => {
    const key = showcaseKey(item)
    if (!key.endsWith(':') && seen.has(key)) return
    seen.add(key)
    out.push(item)
  }
  for (const item of attached || []) take(item)
  for (const item of inferred) take(item)
  return out.slice(0, 10)
}

export type ChatMentionNode =
  | { type: 'text'; text: string }
  | { type: 'link'; label: string; href: string }

/** Split a plain run so catalog names become in-app chips. */
export function splitMarketplaceMentions(text: string): ChatMentionNode[] {
  if (!text) return []
  const lower = text.toLowerCase()
  const out: ChatMentionNode[] = []
  let cursor = 0
  while (cursor < text.length) {
    let hit: { start: number; end: number; slug: string } | null = null
    for (const mention of marketplaceMentionIndex()) {
      const at = lower.indexOf(mention.name, cursor)
      if (at < 0) continue
      const end = at + mention.name.length
      if (!isMentionBoundary(text, at, end)) continue
      if (!isSafeMentionSlice(text.slice(at, end))) continue
      if (!hit || at < hit.start || (at === hit.start && end - at > hit.end - hit.start)) {
        hit = { start: at, end, slug: mention.slug }
      }
    }
    if (!hit) {
      out.push({ type: 'text', text: text.slice(cursor) })
      break
    }
    if (hit.start > cursor) out.push({ type: 'text', text: text.slice(cursor, hit.start) })
    out.push({
      type: 'link',
      label: text.slice(hit.start, hit.end),
      href: marketplaceConnectPath(hit.slug),
    })
    cursor = hit.end
  }
  return out
}
