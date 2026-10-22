import { useEffect } from 'react'
import { loadPreferences, setPref } from './preferences'
import { lastInboxPath } from './inbox-prefs'
import { newConversationPath } from './messages-paths'
import { OVERVIEW_PATH } from './navigation'

/** Where `/` opens after sign-in. Default is a blank new conversation. */
export type DefaultLanding = 'new' | 'inbox' | 'agenda' | 'today'

const LANDING_KEY = 'bokito-default-landing'

const CANONICAL: readonly DefaultLanding[] = ['new', 'inbox', 'agenda', 'today']

/** Older preference values stored before the four-way start page. */
const LEGACY: Record<string, DefaultLanding> = {
  chat: 'new',
  communication: 'inbox',
  overview: 'today',
}

export function parseDefaultLanding(raw: unknown): DefaultLanding {
  if (typeof raw === 'string') {
    if ((CANONICAL as readonly string[]).includes(raw)) return raw as DefaultLanding
    if (raw in LEGACY) return LEGACY[raw]
  }
  return 'new'
}

export function readCachedDefaultLanding(): DefaultLanding {
  try {
    return parseDefaultLanding(window.localStorage.getItem(LANDING_KEY))
  } catch {
    return 'new'
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
  switch (landing) {
    case 'inbox':
      return lastInboxPath()
    case 'agenda':
      return '/agenda'
    case 'today':
      return OVERVIEW_PATH
    case 'new':
    default:
      return newConversationPath()
  }
}

/** Keep localStorage in sync with `/me/preferences` so HomeRoute can redirect instantly. */
export function useDefaultLandingSync(token: string | null) {
  useEffect(() => {
    if (!token) return
    let cancelled = false
    void loadPreferences(token)
      .then((data) => {
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
  try {
    const data = await loadPreferences(token)
    const landing = parseDefaultLanding(data.default_landing)
    writeCachedDefaultLanding(landing)
    return landing
  } catch {
    return readCachedDefaultLanding()
  }
}

export async function persistDefaultLanding(token: string, landing: DefaultLanding): Promise<void> {
  await setPref('default_landing', landing, token)
  writeCachedDefaultLanding(landing)
}
