import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { appRoutes } from '../api/routes'
import { APP_API_BASE, parseUiLanguage } from './api.config'

/**
 * Applies the signed-in user's saved UI language (`/me/preferences`
 * `ui_language`) app-wide. Without this, the language chosen under
 * Settings -> General only took effect on that page: other routes fell back
 * to the browser default after a full page load.
 */
export function useLanguagePreferenceSync(token: string | null) {
  const { i18n } = useTranslation()

  useEffect(() => {
    if (!token) return
    const urlLang = new URLSearchParams(window.location.search).get('lang')
    if (urlLang === 'en' || urlLang === 'nl') return
    let cancelled = false
    void fetch(`${APP_API_BASE}${appRoutes.me.preferences}`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { ui_language?: string } | null) => {
        if (cancelled) return
        const lang = data?.ui_language
        if ((lang === 'nl' || lang === 'en') && i18n.resolvedLanguage !== lang) {
          void i18n.changeLanguage(lang)
          document.documentElement.lang = lang
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [token, i18n])
}

/** Onboarding/public pages: `?lang=nl` or `?lang=en`. Empty or missing uses the platform default. */
export function useOnboardingLanguageFromUrl() {
  const [params] = useSearchParams()
  const { i18n } = useTranslation()

  useEffect(() => {
    const raw = params.get('lang')
    if (raw == null || raw.trim() === '') return
    const normalized = raw.trim().toLowerCase()
    if (normalized !== 'en' && normalized !== 'nl') return
    const lang = parseUiLanguage(normalized)
    if (i18n.resolvedLanguage !== lang) {
      void i18n.changeLanguage(lang)
    }
    document.documentElement.lang = lang
    try {
      window.localStorage.setItem('bokito-language', lang)
    } catch {
      // Ignore private-mode storage failures.
    }
  }, [params, i18n])
}

/** Switch the UI language immediately, then persist when signed in. */
export function applyUiLanguageLocally(
  i18n: { changeLanguage: (lang: string) => Promise<unknown> },
  language: string,
): 'en' | 'nl' {
  const lang = parseUiLanguage(language)
  void i18n.changeLanguage(lang)
  document.documentElement.lang = lang
  try {
    window.localStorage.setItem('bokito-language', lang)
  } catch {
    // Ignore private-mode storage failures.
  }
  return lang
}

export async function persistUiLanguage(token: string, language: string): Promise<void> {
  const lang = parseUiLanguage(language)
  const res = await fetch(`${APP_API_BASE}${appRoutes.me.preferences}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    credentials: 'include',
    body: JSON.stringify({ ui_language: lang }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  try {
    window.localStorage.setItem('bokito-language', lang)
    document.documentElement.lang = lang
  } catch {
    // Ignore private-mode storage failures.
  }
}
