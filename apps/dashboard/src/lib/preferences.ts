import { useEffect, useState } from 'react'
import { appRoutes } from '../api/routes'
import { useAuth } from '../context/AuthContext'
import { apiGet, apiPatch, resolveAccessToken } from './api'

/** Shape of `GET /me/preferences`. Extra keys are kept so callers can read one field. */
export type Preferences = Record<string, unknown>

let cache: Preferences | null = null
let cacheToken: string | null = null
let inflight: Promise<Preferences> | null = null
let inflightToken: string | null = null
const listeners = new Set<(prefs: Preferences) => void>()
const clearHooks = new Set<() => void>()

export function peekPreferences(): Preferences | null {
  return cache
}

export function subscribePreferences(listener: (prefs: Preferences) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Side caches (folder prefs, and similar) reset when the session prefs cache drops. */
export function onPreferencesClear(hook: () => void): () => void {
  clearHooks.add(hook)
  return () => clearHooks.delete(hook)
}

export function clearPreferencesCache(): void {
  cache = null
  cacheToken = null
  inflight = null
  inflightToken = null
  for (const hook of clearHooks) hook()
}

function remember(token: string | null, prefs: Preferences): Preferences {
  cache = prefs
  cacheToken = token
  for (const listener of listeners) listener(prefs)
  return prefs
}

/** One shared GET. Later calls in the same session reuse the response. */
export function loadPreferences(token?: string): Promise<Preferences> {
  const resolved = resolveAccessToken(token)
  if (cache && cacheToken === resolved) return Promise.resolve(cache)
  if (inflight && inflightToken === resolved) return inflight
  const request = apiGet<Preferences>(appRoutes.me.preferences, token)
    .then((prefs) => {
      if (inflight === request) inflight = null
      return remember(resolved, prefs)
    })
    .catch((err: unknown) => {
      if (inflight === request) {
        inflight = null
        inflightToken = null
      }
      throw err
    })
  inflight = request
  inflightToken = resolved
  return request
}

/** PATCH one or more keys. The server returns the full preferences object. */
export async function patchPreferences(
  partial: Record<string, unknown>,
  token?: string,
): Promise<Preferences> {
  const resolved = resolveAccessToken(token)
  const next = await apiPatch<Preferences>(appRoutes.me.preferences, partial, token)
  return remember(resolved, next)
}

export function setPref(key: string, value: unknown, token?: string): Promise<Preferences> {
  return patchPreferences({ [key]: value }, token)
}

/** Cached value, or `fallback` when this session has not loaded preferences yet. */
export function getPref<T>(key: string, fallback: T): T {
  if (!cache || !(key in cache)) return fallback
  return cache[key] as T
}

/** Live value for one preferences key. `fallback` is used until the GET resolves. */
export function usePreference<T>(key: string, fallback: T): T {
  const { token } = useAuth()
  const [value, setValue] = useState<T>(() => getPref(key, fallback))

  useEffect(() => {
    if (!token) return
    const apply = (prefs: Preferences) => {
      setValue(key in prefs ? (prefs[key] as T) : fallback)
    }
    const unsubscribe = subscribePreferences(apply)
    void loadPreferences(token)
      .then(apply)
      .catch(() => setValue(fallback))
    return unsubscribe
  }, [key, fallback, token])

  return value
}
