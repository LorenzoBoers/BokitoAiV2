/**
 * Bubble grouping for every chat surface: the dashboard thread timeline and
 * the website widget. Shared so a run of messages reads the same in the app
 * and on a customer's site — same gap, same first/last bubble in a run.
 *
 * Styling stays per surface (Tailwind in the dashboard, Shadow DOM CSS in the
 * widget); only the rules live here.
 */

/** Position of a bubble inside a run of consecutive same-author messages. */
export type BubbleStack = 'single' | 'start' | 'middle' | 'end'

/** Consecutive same-author messages further apart than this start a new group. */
export const CHAT_STACK_GAP_MS = 5 * 60 * 1000

/** Reading column shared by bubbles and the composer. */
export const CHAT_COLUMN_MAX_PX = 720

/** Space between bubbles inside a run, and between runs. */
export const CHAT_STACK_GAP_PX = 2
export const CHAT_RUN_GAP_PX = 14

export type ChatStackInput = {
  id: string
  /**
   * Author + lane key. Rows with the same key and close enough in time form a
   * run. `null` never groups (decision cards, one-off rows).
   */
  key: string | null
  /** Epoch ms. Non-finite values are treated as 0. */
  timeMs: number
  /** Non-bubble rows (events, separators) end the run that precedes them. */
  breaksRun?: boolean
}

/**
 * Assign single/start/middle/end per row, in timeline order.
 *
 * The first bubble of a run carries the avatar and name, the last one the
 * timestamp; the corners facing a neighbour tighten. Rows that break a run
 * (and rows without a key) are not in the map as part of a run.
 */
export function assignBubbleStacks(
  items: ChatStackInput[],
  gapMs: number = CHAT_STACK_GAP_MS,
): Map<string, BubbleStack> {
  const map = new Map<string, BubbleStack>()
  let runKey: string | null = null
  let runIds: string[] = []
  let lastTime = 0

  const flush = () => {
    if (runIds.length === 0) return
    if (runIds.length === 1) {
      map.set(runIds[0], 'single')
    } else {
      map.set(runIds[0], 'start')
      for (let i = 1; i < runIds.length - 1; i++) map.set(runIds[i], 'middle')
      map.set(runIds[runIds.length - 1], 'end')
    }
    runIds = []
    runKey = null
  }

  for (const item of items) {
    if (item.breaksRun) {
      flush()
      continue
    }
    const time = Number.isFinite(item.timeMs) ? item.timeMs : 0
    if (runIds.length > 0 && time - lastTime > gapMs) flush()
    lastTime = time
    if (!item.key) {
      flush()
      map.set(item.id, 'single')
      continue
    }
    if (item.key === runKey) {
      runIds.push(item.id)
    } else {
      flush()
      runKey = item.key
      runIds = [item.id]
    }
  }
  flush()
  return map
}

/** True for the bubble that carries the avatar and the author line. */
export const chatRunLeads = (stack: BubbleStack): boolean =>
  stack === 'single' || stack === 'start'

/** True for the bubble that carries the timestamp. */
export const chatRunCloses = (stack: BubbleStack): boolean =>
  stack === 'single' || stack === 'end'
