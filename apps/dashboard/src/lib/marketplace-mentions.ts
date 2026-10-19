/**
 * Showcase cards the agent attached on purpose.
 * Plain catalog words (Outlook, Moneybird, …) stay text. A chip is a markdown
 * link the agent wrote; a card is `attach_items` or a tool that showcases.
 */
import type { ProposalItem } from './inbox-api'

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
  extra: ProposalItem[] = [],
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
  for (const item of extra) take(item)
  return out.slice(0, 10)
}
