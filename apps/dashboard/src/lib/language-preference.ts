import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { APP_API_BASE } from './api.config'

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
    let cancelled = false
    void fetch(`${APP_API_BASE}/me/preferences`, {
      headers: { Authorization: `Bearer ${token}` },
      credentials: 'include',
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { ui_language?: string } | null) => {
        if (cancelled) return
        const lang = data?.ui_language
        if ((lang === 'nl' || lang === 'en') && i18n.resolvedLanguage !== lang) {
          void i18n.changeLanguage(lang)
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [token, i18n])
}
