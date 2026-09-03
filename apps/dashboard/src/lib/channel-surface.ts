/** Channel kinds parked from the product surface.
 *
 * The platform owns the list (PARKED_CHANNELS on the API, served on
 * `/auth/me`); the dashboard mirrors it here so connect flows, hub folders and
 * notification columns can hide a channel without every call site fetching the
 * session. The default matches the API default so the very first render — before
 * `/auth/me` resolves — already hides a parked channel instead of flashing it.
 */

const DEFAULT_PARKED_CHANNELS = ['slack']

let parked: readonly string[] = DEFAULT_PARKED_CHANNELS

/** Normalize a raw list (e.g. from `/auth/me`) into lowercase channel keys. */
export function normalizeParkedChannels(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_PARKED_CHANNELS]
  return raw
    .map((entry) => (typeof entry === 'string' ? entry.trim().toLowerCase() : ''))
    .filter((entry) => entry.length > 0)
}

/** Adopt the platform list; called once the session is known. */
export function setParkedChannels(list: readonly string[]): void {
  parked = [...list]
}

export function parkedChannels(): readonly string[] {
  return parked
}

export function isChannelParked(channel: string | null | undefined): boolean {
  const key = (channel ?? '').trim().toLowerCase()
  if (!key) return false
  return parked.includes(key)
}

/** Drop parked channels from a list of channel keys, preserving order. */
export function withoutParkedChannels<T extends string>(keys: readonly T[]): T[] {
  return keys.filter((key) => !isChannelParked(key))
}
