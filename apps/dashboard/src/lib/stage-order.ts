import type { TicketStageKind } from './tickets-api'

/**
 * Pipeline order the API enforces in ``validate_stages``:
 * not started, then active, then done, then closed.
 * A group never sits in front of an earlier group.
 *
 * The first stage is always not-started (``open``). Operators never pick or
 * insert extra ``open`` stages — only active / done / closed.
 */
export const STAGE_KIND_ORDER: TicketStageKind[] = ['open', 'waiting', 'done', 'closed']

/** Kinds operators may assign when adding or editing a stage. */
export const EDITABLE_STAGE_KINDS: TicketStageKind[] = ['waiting', 'done', 'closed']

function rank(kind: TicketStageKind): number {
  const index = STAGE_KIND_ORDER.indexOf(kind)
  return index < 0 ? STAGE_KIND_ORDER.length : index
}

export function stageKindsInOrder(stages: { kind: TicketStageKind }[]): boolean {
  return firstOutOfOrder(stages) < 0
}

/** Index of the first stage that sits in an earlier group than the one before it. */
export function firstOutOfOrder(stages: { kind: TicketStageKind }[]): number {
  for (let i = 1; i < stages.length; i += 1) {
    if (rank(stages[i].kind) < rank(stages[i - 1].kind)) return i
  }
  return -1
}

/** Kinds the stage at ``index`` may take while the rest of the pipeline stays in order. */
export function allowedKindsAt(
  stages: { kind: TicketStageKind }[],
  index: number,
): TicketStageKind[] {
  const prev = index > 0 ? rank(stages[index - 1].kind) : 0
  const next =
    index < stages.length - 1 ? rank(stages[index + 1].kind) : STAGE_KIND_ORDER.length - 1
  return EDITABLE_STAGE_KINDS.filter((kind) => {
    const value = rank(kind)
    return value >= prev && value <= next
  })
}

/**
 * Kind for a stage inserted at ``index`` (before the stage that is there now).
 * Never ``open`` — that stays reserved for the first column.
 */
export function kindForInsert(
  stages: { kind: TicketStageKind }[],
  index: number,
): TicketStageKind {
  const left = index > 0 ? stages[index - 1]?.kind : undefined
  if (left && left !== 'open') return left
  return 'waiting'
}

/**
 * Pie fill for an active stage. Matches ``waiting_stage_progress`` in the API:
 * position among the active stages, never a full circle.
 */
export function waitingStageFill(
  stages: { kind: TicketStageKind }[],
  index: number,
): number | undefined {
  if (stages[index]?.kind !== 'waiting') return undefined
  const group = stages.flatMap((stage, i) => (stage.kind === 'waiting' ? [i] : []))
  const pos = group.indexOf(index)
  if (pos < 0 || group.length === 0) return undefined
  return (pos + 1) / (group.length + 1)
}

export function moveKeepsOrder(
  stages: { kind: TicketStageKind }[],
  index: number,
  direction: -1 | 1,
): boolean {
  const target = index + direction
  if (index < 0 || target < 0 || target >= stages.length) return false
  const next = [...stages]
  const [row] = next.splice(index, 1)
  if (!row) return false
  next.splice(target, 0, row)
  return stageKindsInOrder(next)
}
