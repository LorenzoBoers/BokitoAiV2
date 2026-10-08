/**
 * Options of a DecisionRequest, shared by the standalone decision card and
 * the inline proposal under an agent bubble.
 */
import { isModuleSetupAction } from './integration-setup-url'

export type DecisionOption = {
  id: string
  label: string
  action_type?: string
  payload?: Record<string, unknown>
  input_type?: 'text'
  input_placeholder?: string
  /** Showcase item this option chooses (type + id). */
  item_ref?: { type: string; id: string } | null
  learn?: { tool: string; reason: string; ruleText: string }
}

export function parseDecisionOptions(options: unknown): DecisionOption[] {
  if (!Array.isArray(options)) return []
  return options
    .map((row): DecisionOption | null => {
      if (!row || typeof row !== 'object') return null
      const raw = row as Record<string, unknown>
      const id = typeof raw.id === 'string' ? raw.id : ''
      if (!id) return null
      const itemRaw = raw.item_ref
      let item_ref: DecisionOption['item_ref'] = null
      if (itemRaw && typeof itemRaw === 'object' && !Array.isArray(itemRaw)) {
        const ir = itemRaw as Record<string, unknown>
        const type = typeof ir.type === 'string' ? ir.type : ''
        const itemId = ir.id != null ? String(ir.id) : ''
        if (type && itemId) item_ref = { type, id: itemId }
      }
      return {
        id,
        label: typeof raw.label === 'string' ? raw.label : id,
        action_type: typeof raw.action_type === 'string' ? raw.action_type : undefined,
        payload:
          raw.payload && typeof raw.payload === 'object'
            ? (raw.payload as Record<string, unknown>)
            : undefined,
        input_type: raw.input_type === 'text' ? 'text' : undefined,
        input_placeholder:
          typeof raw.input_placeholder === 'string' ? raw.input_placeholder : undefined,
        item_ref,
        learn:
          raw.learn && typeof raw.learn === 'object'
            ? {
                tool: String((raw.learn as Record<string, unknown>).tool ?? ''),
                reason: String((raw.learn as Record<string, unknown>).reason ?? ''),
                ruleText: String((raw.learn as Record<string, unknown>).rule_text ?? ''),
              }
            : undefined,
      }
    })
    .filter((o): o is DecisionOption => o !== null)
}

/** Map a showcase item to a decision option id (item_ref or matching option id). */
export function optionIdForProposalItem(
  item: { type: string; id: string },
  options: unknown,
): string | null {
  const parsed = parseDecisionOptions(options)
  const byRef = parsed.find(
    (o) => o.item_ref && o.item_ref.type === item.type && o.item_ref.id === item.id,
  )
  if (byRef) return byRef.id
  const byId = parsed.find((o) => o.id === item.id)
  return byId?.id ?? null
}

/**
 * Known option ids/action types get a translated button label so the card
 * follows the user's platform language; unknown (agent-authored) options
 * keep the label the agent wrote.
 */
export function decisionOptionLabelKey(option: DecisionOption): string | null {
  // Queue proposals: approve reads as the action it performs.
  if (option.action_type === 'create_queue_item') {
    if (option.id === 'approve') return 'addToQueue'
  }
  const byId: Record<string, string> = {
    send: 'send',
    edit: 'edit',
    escalate: 'escalate',
    close: 'closeThread',
    create_task: 'createTask',
    look_at: 'createTask',
    keep_open: 'keepOpen',
    approve: 'approve',
    reject: 'reject',
    later: 'later',
    defer: 'defer',
    enable: 'turnOn',
    connect: 'connectPackage',
  }
  if (byId[option.id]) {
    // An agent-written approve/reject label ("Terugzetten") says more than the default.
    const label = (option.label || '').trim()
    const generic = ['approve', 'reject', 'Approve', 'Reject'].includes(label)
    if ((option.id === 'approve' || option.id === 'reject') && label && label !== option.id && !generic) {
      return null
    }
    return byId[option.id]
  }
  // Remap known action_types only for canonical single-purpose options.
  // Agent-authored multi-choice cards often share action_type "escalate"
  // (human takeover) while carrying distinct labels — never overwrite those.
  const byAction: Record<string, string> = {
    send_reply: 'send',
    send_email: 'send',
    draft: 'edit',
    close_thread: 'closeThread',
    create_task: 'createTask',
    look_at: 'createTask',
    create_queue_item: 'addToQueue',
    approve: 'approve',
    defer: 'keepOpen',
    reject: 'reject',
    enable_module: 'turnOn',
    setup_integration: 'connectPackage',
    add_module_source: 'addSource',
  }
  if (option.action_type && byAction[option.action_type]) {
    // Keep a distinctive agent label when present (non-empty and not just the id).
    const label = (option.label || '').trim()
    if (label && label !== option.id) return null
    return byAction[option.action_type]
  }
  return null
}

export function isPrimaryDecisionOption(option: DecisionOption): boolean {
  return (
    option.id === 'send' ||
    option.id === 'approve' ||
    option.action_type === 'send_reply' ||
    option.action_type === 'send_email' ||
    option.action_type === 'close_thread' ||
    option.action_type === 'approve' ||
    isModuleSetupAction(option.action_type)
  )
}

/** Drop "Kies hieronder / - Ja / - Nee" tails when buttons already show choices. */
export function stripChoiceEcho(text: string): string {
  const cleaned = text
    .replace(
      /(?:\n\s*)+(?:Kies hieronder|Choose below|Pick one)\s*:?\s*(?:\n\s*[-*•]\s+.+)+\s*$/i,
      '',
    )
    .trimEnd()
  if (/^(?:Kies hieronder|Choose below|Pick one)\s*:?\s*(?:\n\s*[-*•]\s+.+)+$/i.test(cleaned)) {
    return ''
  }
  return cleaned
}

export function isRejectDecisionOption(option: DecisionOption): boolean {
  return option.id === 'reject' || option.action_type === 'reject'
}

/** Soft composer answers that mean Approve / Reject for a single open card. */
export type SoftDecisionReply =
  | { kind: 'approve'; optionId: string }
  | { kind: 'reject'; optionId: string }

function _normSoftReply(text: string): string {
  return text.trim().toLowerCase().replace(/[.!]+$/g, '')
}

/**
 * Map a short Ask-box answer ("Ja", "Nee", "Yes", "No", "Ja graag") onto a
 * classic Ja/Nee proposal. Multi-select and text-input cards are left to the
 * buttons.
 */
export function matchSoftDecisionReply(
  text: string,
  options: DecisionOption[],
): SoftDecisionReply | null {
  const normalized = _normSoftReply(text)
  if (!normalized || options.length === 0) return null
  const rejectOpt = options.find(isRejectDecisionOption)
  const approveOpts = options.filter((o) => !isRejectDecisionOption(o) && o.input_type !== 'text')
  // Multi-select / many choices: only when there is a single non-reject option
  // (classic Ja/Nee card).
  if (approveOpts.length !== 1) return null
  const approveOpt = approveOpts[0]
  const approveLabel = _normSoftReply(approveOpt.label || '')
  const rejectLabel = rejectOpt ? _normSoftReply(rejectOpt.label || '') : ''
  if (
    ['ja', 'yes', 'y', 'ok', 'okay', 'goed', 'ja graag', 'graag'].includes(normalized) ||
    (approveLabel && normalized === approveLabel)
  ) {
    return { kind: 'approve', optionId: approveOpt.id }
  }
  if (
    rejectOpt &&
    (['nee', 'no', 'n', 'cancel', 'annuleer', 'nee dank', 'nee bedankt'].includes(normalized) ||
      (rejectLabel && normalized === rejectLabel))
  ) {
    return { kind: 'reject', optionId: rejectOpt.id }
  }
  return null
}

/**
 * Among several open cards, soft Ja/Nee only fires when exactly one card is a
 * classic binary proposal. Multi/text cards can stay open without blocking.
 */
export function pickSoftDecisionTarget<T extends { options: DecisionOption[] }>(
  text: string,
  openCards: T[],
): (T & { soft: SoftDecisionReply }) | null {
  if (!openCards.length) return null
  const hits: (T & { soft: SoftDecisionReply })[] = []
  for (const card of openCards) {
    const soft = matchSoftDecisionReply(text, card.options)
    if (soft) hits.push({ ...card, soft })
  }
  return hits.length === 1 ? hits[0] : null
}
