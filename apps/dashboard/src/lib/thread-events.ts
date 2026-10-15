/** Fields on a `thread_updated` patch that change something an operator can see. */
export function threadPatchHasMeaning(payload?: Record<string, unknown> | null): boolean {
  if (!payload) return false
  if (typeof payload.status === 'string' && payload.status) return true
  if (typeof payload.bulk === 'string' && payload.bulk) return true
  if (payload.assigned_to != null) return true
  if (typeof payload.priority === 'string' && payload.priority) return true
  if (Array.isArray(payload.tags)) return true
  if (Array.isArray(payload.tags_added) && payload.tags_added.length > 0) return true
  if (Array.isArray(payload.tags_removed) && payload.tags_removed.length > 0) return true
  return false
}

function tagNames(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((n): n is string => typeof n === 'string')
    .map((n) => n.replace(/^#/, '').trim())
    .filter(Boolean)
}

type TagEventLike = {
  eventType: string
  createdAt: string
  payload: Record<string, unknown>
}

/**
 * Older `thread_updated` rows only stored the full tag list. Walk chronologically
 * and fill `tags_added` / `tags_removed` so the timeline shows one new label per
 * step instead of re-listing every label each time.
 */
export function withTagDiffs<T extends TagEventLike>(events: T[]): T[] {
  const ordered = events
    .map((event, index) => ({ event, index }))
    .sort((a, b) => {
      const byTime = new Date(a.event.createdAt).getTime() - new Date(b.event.createdAt).getTime()
      return byTime !== 0 ? byTime : a.index - b.index
    })

  let prior: string[] | null = null
  const patched = new Map<number, T>()

  for (const { event, index } of ordered) {
    const isTagPatch =
      event.eventType === 'thread_updated' ||
      event.eventType === 'tag_added' ||
      event.eventType === 'tag_removed'
    if (!isTagPatch) {
      patched.set(index, event)
      continue
    }

    const payload = event.payload ?? {}
    const hasDiff =
      Array.isArray(payload.tags_added) || Array.isArray(payload.tags_removed)

    if (hasDiff) {
      if (Array.isArray(payload.tags)) {
        prior = tagNames(payload.tags)
      } else if (prior) {
        const added = new Set(tagNames(payload.tags_added))
        const removed = new Set(tagNames(payload.tags_removed))
        prior = [...prior.filter((name) => !removed.has(name)), ...added]
      }
      patched.set(index, event)
      continue
    }

    if (!Array.isArray(payload.tags)) {
      patched.set(index, event)
      continue
    }

    const next = tagNames(payload.tags)
    if (prior === null) {
      prior = next
      patched.set(index, {
        ...event,
        payload: { ...payload, tags_added: next, tags_removed: [] },
      })
      continue
    }

    const priorSet = new Set(prior)
    const nextSet = new Set(next)
    const added = next.filter((name) => !priorSet.has(name))
    const removed = prior.filter((name) => !nextSet.has(name))
    prior = next
    patched.set(index, {
      ...event,
      payload: { ...payload, tags_added: added, tags_removed: removed },
    })
  }

  return events.map((_, index) => patched.get(index) ?? events[index])
}
