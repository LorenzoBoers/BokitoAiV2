import { useEffect } from 'react'
import { appRoutes } from '../api/routes'
import { APP_API_BASE } from './api.config'
import { lastInboxPath } from './inbox-prefs'
import { newConversationPath } from './messages-paths'
import { OVERVIEW_PATH } from './navigation'

export type DefaultLanding = 'chat' | 'communication' | 'overview'

const LANDING_KEY = 'bokito-default-landing'

export function parseDefaultLanding(raw: unknown): DefaultLanding {
  if (raw === 'overview' || raw === 'communication' || raw === 'chat') return raw
  return 'chat'
}

export function readCachedDefaultLanding(): DefaultLanding {
  try {
    return parseDefaultLanding(window.localStorage.getItem(LANDING_KEY))
  } catch {
    return 'chat'
  }
}

export function writeCachedDefaultLanding(landing: DefaultLanding): void {
  try {
    window.localStorage.setItem(LANDING_KEY, landing)
  } catch {
    // ignore private-mode / quota
  }
}

/** Path to open after login / home when no explicit return_to is set. */
export function pathForDefaultLanding(landing: DefaultLanding = readCachedDefaultLanding()): string {
  if (landing === 'overview') return OVERVIEW_PATH
  if (landing === 'communication') return lastInboxPath()
  return newConversationPath()
}

/** Keep localStorage in sync with `/me/preferences` so HomeRoute can redirect instantly. */
export function useDefaultLandingSync(token: string | null) {
  useEffect(() => {
    if (!token) return
    let cancelled = false
    void fetch(`${APP_API_BASE}${appRoutes.me.preferences}`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { default_landing?: string } | null) => {
        if (cancelled || !data) return
        writeCachedDefaultLanding(parseDefaultLanding(data.default_landing))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [token])
}

export async function fetchDefaultLanding(token: string): Promise<DefaultLanding> {
  const res = await fetch(`${APP_API_BASE}${appRoutes.me.preferences}`, {
    headers: { Authorization: `Bearer ${token}` },
    credentials: 'include',
  })
  if (!res.ok) return readCachedDefaultLanding()
  const data = (await res.json()) as { default_landing?: string }
  const landing = parseDefaultLanding(data.default_landing)
  writeCachedDefaultLanding(landing)
  return landing
}

export async function persistDefaultLanding(token: string, landing: DefaultLanding): Promise<void> {
  const res = await fetch(`${APP_API_BASE}${appRoutes.me.preferences}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ default_landing: landing }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  writeCachedDefaultLanding(landing)
}
