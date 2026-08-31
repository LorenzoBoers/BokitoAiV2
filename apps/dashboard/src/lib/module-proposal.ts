/**
 * Shared summary model for module write proposals on decision cards.
 *
 * Module proposals carry the canonical payload on the approve option
 * (action_type `{module}_apply_{kind}`). The card is schema-driven: it
 * renders whatever fields the payload carries, so any module's proposals
 * surface without UI changes.
 */

type ProposalOption = {
  action_type?: string | null
  payload?: Record<string, unknown> | null
}

export type ModuleProposal = {
  /** Module slug derived from the apply tool name, e.g. "accounting". */
  module: string
  /** Write kind derived from the apply tool name, e.g. "party" | "booking". */
  kind: string
  rows: Array<{ label: string; value: string }>
}

const APPLY_RE = /^([a-z0-9]+)_apply_([a-z0-9_]+)$/

/** Payload keys that are routing detail, not approval-relevant fields. */
const HIDDEN_KEYS = new Set(['connection_id', 'signal_id', 'company_id', 'party_id'])

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) {
    if (value.length === 0) return ''
    const total = value.reduce((sum: number, item) => {
      const record = item as Record<string, unknown>
      const amount = Number(record?.amount ?? record?.debit ?? record?.credit)
      return Number.isFinite(amount) && amount > 0 ? sum + amount : sum
    }, 0)
    return `${value.length}${total > 0 ? ` — ${total.toFixed(2)}` : ''}`
  }
  if (typeof value === 'object') return ''
  return String(value).trim()
}

export function moduleProposalFromOptions(
  options: ProposalOption[],
): ModuleProposal | null {
  let match: RegExpExecArray | null = null
  let option: ProposalOption | undefined
  for (const o of options) {
    match = APPLY_RE.exec(o.action_type ?? '')
    if (match) {
      option = o
      break
    }
  }
  if (!match || !option?.payload) return null
  const payload = option.payload
  const rows: Array<{ label: string; value: string }> = []
  const push = (label: string, value: unknown) => {
    const text = formatValue(value)
    if (text) rows.push({ label, value: text })
  }
  // Human company label wins over the raw id.
  push('company', payload.company_label ?? payload.company_id)
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'company_label' || HIDDEN_KEYS.has(key)) continue
    push(key, value)
  }
  return rows.length > 0 ? { module: match[1], kind: match[2], rows } : null
}
