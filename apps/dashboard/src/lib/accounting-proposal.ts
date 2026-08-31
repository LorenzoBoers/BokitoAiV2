/**
 * Shared summary model for accounting write proposals on decision cards.
 *
 * Accounting proposals carry the canonical payload on the approve option
 * (action_type `accounting_apply_*`). Both the inbox decision card and the
 * agent-chat decision card surface the fields that matter for the approval:
 * administration, contact/booking details, and amounts.
 */

type ProposalOption = {
  action_type?: string | null
  payload?: Record<string, unknown> | null
}

export type AccountingProposal = {
  /** Write kind derived from the apply tool name, e.g. "party" | "booking". */
  kind: string
  rows: Array<{ label: string; value: string }>
}

export function accountingProposalFromOptions(
  options: ProposalOption[],
): AccountingProposal | null {
  const option = options.find((o) => (o.action_type ?? '').startsWith('accounting_apply_'))
  if (!option?.payload) return null
  const kind = (option.action_type ?? '').replace('accounting_apply_', '')
  const payload = option.payload
  const rows: Array<{ label: string; value: string }> = []
  const push = (label: string, value: unknown) => {
    if (value === null || value === undefined) return
    const text = String(value).trim()
    if (text) rows.push({ label, value: text })
  }
  push('company', payload.company_label ?? payload.company_id)
  push('party', payload.party_id ?? payload.name)
  // Party proposals carry the party role ("customer" | "supplier") as `role`.
  push('kind', payload.kind ?? payload.role)
  push('description', payload.description)
  push('date', payload.date)
  push('journal', payload.journal_code)
  push('reference', payload.reference)
  push('email', payload.email)
  const lines = payload.lines
  if (Array.isArray(lines) && lines.length > 0) {
    const total = lines.reduce((sum, line) => {
      const amount = Number((line as Record<string, unknown>)?.amount)
      return Number.isFinite(amount) && amount > 0 ? sum + amount : sum
    }, 0)
    push('lines', `${lines.length}${total > 0 ? ` — ${total.toFixed(2)}` : ''}`)
  }
  push('amount', payload.amount)
  return rows.length > 0 ? { kind, rows } : null
}
