import { createContext, type MutableRefObject } from 'react'

/** Shared with mail iframes, whose wheel events never reach the timeline scroller. */
export type TimelineScrollApi = {
  scroller: MutableRefObject<HTMLDivElement | null>
  /** Operator is reading upward; stop pinning the list to the latest row. */
  releaseFollow: () => void
  /** Record a wheel so scrolling back to the end can resume follow. */
  noteWheel: (deltaY: number) => void
  /** True while browser scroll anchoring must stay off (following, or the reader is scrolling). */
  anchorOffRef: MutableRefObject<boolean>
}

export const TimelineScrollContext = createContext<TimelineScrollApi | null>(null)
