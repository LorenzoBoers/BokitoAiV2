import type { InboxListQuickFilter } from './inbox-prefs'

/** Inclusive range select for bulk checkboxes (Gmail/Linear style). */
export function toggleOrRangeSelect(
  orderedIds: string[],
  current: ReadonlySet<string>,
  clickedId: string,
  anchorId: string | null,
  shiftKey: boolean,
): { next: Set<string>; anchor: string } {
  if (shiftKey && anchorId) {
    const a = orderedIds.indexOf(anchorId)
    const b = orderedIds.indexOf(clickedId)
    const next = new Set(current)
    if (a >= 0 && b >= 0) {
      const [lo, hi] = a < b ? [a, b] : [b, a]
      for (let i = lo; i <= hi; i++) next.add(orderedIds[i]!)
    } else {
      next.add(clickedId)
    }
    return { next, anchor: clickedId }
  }
  const next = new Set(current)
  if (next.has(clickedId)) next.delete(clickedId)
  else next.add(clickedId)
  return { next, anchor: clickedId }
}

/** Walk only unread threads, wrapping around the current list. */
export function nextUnreadId(
  threads: Array<{ id: string | number; hasUnread?: boolean }>,
  selectedId: string | number | null,
  direction: 1 | -1,
): string | null {
  const rows = threads.map((thread) => ({ id: String(thread.id), unread: Boolean(thread.hasUnread) }))
  if (!rows.some((row) => row.unread)) return null
  const start =
    selectedId == null
      ? direction === 1
        ? -1
        : 0
      : rows.findIndex((row) => row.id === String(selectedId))
  const from = start < 0 && direction === -1 ? 0 : start
  for (let step = 1; step <= rows.length; step++) {
    const idx = (((from + direction * step) % rows.length) + rows.length) % rows.length
    if (rows[idx]?.unread) return rows[idx]!.id
  }
  return null
}

export function parseQuickFilterParam(raw: string | null | undefined): InboxListQuickFilter | null {
  if (!raw) return null
  if (raw === 'unread' || raw === 'needsReply' || raw === 'pinned' || raw === 'all') return raw
  if (raw === 'needs_reply') return 'needsReply'
  return null
}

export type StoredComposerDraft = { body: string; cc: string; bcc: string }

export function parseComposerDraft(raw: string): StoredComposerDraft {
  if (!raw) return { body: '', cc: '', bcc: '' }
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as Partial<StoredComposerDraft>
      if (typeof parsed.body === 'string') {
        return {
          body: parsed.body,
          cc: typeof parsed.cc === 'string' ? parsed.cc : '',
          bcc: typeof parsed.bcc === 'string' ? parsed.bcc : '',
        }
      }
    } catch {
      // Legacy plain-text drafts stay as the body.
    }
  }
  return { body: raw, cc: '', bcc: '' }
}

export function serializeComposerDraft(draft: StoredComposerDraft): string {
  if (!draft.cc && !draft.bcc) return draft.body
  return JSON.stringify(draft)
}

export type SavedInboxSearch = { id: string; name: string; query: string }

const SAVED_SEARCHES_KEY = 'bokito.inbox.savedSearches'

export function readSavedSearches(): SavedInboxSearch[] {
  try {
    const raw = window.localStorage.getItem(SAVED_SEARCHES_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as SavedInboxSearch[]
    return Array.isArray(parsed)
      ? parsed.filter((row) => row && typeof row.query === 'string' && typeof row.name === 'string')
      : []
  } catch {
    return []
  }
}

export function writeSavedSearches(rows: SavedInboxSearch[]): void {
  try {
    window.localStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(rows.slice(0, 8)))
  } catch {
    // ignore quota
  }
}

export function listScrollStorageKey(leafKey: string): string {
  return `bokito.inbox.scroll.${leafKey}`
}
