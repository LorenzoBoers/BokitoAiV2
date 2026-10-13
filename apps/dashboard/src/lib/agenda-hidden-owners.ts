/** People and agents hidden on Agenda, kept across reloads (`user:id` | `agent:id`). */

const STORAGE_KEY = 'bokito.agenda.hiddenOwners'

export type AgendaOwnerKey = `user:${string}` | `agent:${string}`

export function ownerVisibilityKey(kind: 'user' | 'agent', id: string): AgendaOwnerKey {
  return `${kind}:${id}`
}

export function readHiddenOwners(): Set<string> {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return new Set()
    return new Set(
      parsed.filter(
        (value): value is string =>
          typeof value === 'string' && /^(user|agent):[\w-]+$/.test(value),
      ),
    )
  } catch {
    return new Set()
  }
}

export function writeHiddenOwners(keys: ReadonlySet<string>): void {
  try {
    if (keys.size === 0) globalThis.localStorage?.removeItem(STORAGE_KEY)
    else globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify([...keys]))
  } catch {
    // Private mode: the switch still hides owners until the next reload.
  }
}
