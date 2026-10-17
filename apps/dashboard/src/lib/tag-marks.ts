import { useSyncExternalStore } from 'react'

export type TagMark = { color: string; icon: string }

let byName = new Map<string, TagMark>()
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Remember label color and icon so every pill can draw the same mark. */
export function rememberTagMarks(
  tags: Array<{ name: string; color?: string; icon?: string }>,
): void {
  let changed = false
  const next = new Map(byName)
  for (const tag of tags) {
    const name = tag.name.replace(/^#/, '').trim()
    if (!name) continue
    const mark: TagMark = { color: tag.color ?? '', icon: tag.icon ?? '' }
    const prev = next.get(name)
    if (prev && prev.color === mark.color && prev.icon === mark.icon) continue
    next.set(name, mark)
    changed = true
  }
  if (!changed) return
  byName = next
  for (const listener of listeners) listener()
}

/** The stored mark for a label name. Stable until that name changes. */
export function useTagMark(name: string): TagMark | undefined {
  const key = name.replace(/^#/, '').trim()
  return useSyncExternalStore(
    subscribe,
    () => byName.get(key),
    () => undefined,
  )
}
