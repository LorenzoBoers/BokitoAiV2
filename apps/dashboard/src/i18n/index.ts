import i18n, { type BackendModule, type ResourceKey } from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import { PLATFORM_DEFAULT_LANGUAGE } from '../lib/api.config'

export const SUPPORTED_LANGUAGES = ['en', 'nl'] as const
export const NAMESPACES = [
  'common',
  'nav',
  'profile',
  'workspace',
  'communication',
  'workspaces',
  'govern',
  'tour',
  'onboarding',
  'calendar',
] as const

/**
 * Locale JSON is loaded per language on demand instead of bundling every
 * language into the first page load. `vite.config.ts` groups each language's
 * namespaces into one chunk (`locales-nl`, `locales-en`), so a Dutch user
 * downloads only the Dutch strings. Call `ensureLanguage()` before rendering
 * (see `main.tsx`) so the first paint is already translated.
 */
const loaders = import.meta.glob<{ default: ResourceKey }>('../locales/*/*.json')

const localeBackend: BackendModule = {
  type: 'backend',
  init() {},
  read(language, namespace, callback) {
    const load = loaders[`../locales/${language}/${namespace}.json`]
    if (!load) {
      callback(null, {})
      return
    }
    load().then(
      (mod) => callback(null, mod.default),
      (err: unknown) => callback(err instanceof Error ? err : new Error(String(err)), null),
    )
  },
}

i18n
  .use(localeBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: PLATFORM_DEFAULT_LANGUAGE,
    supportedLngs: [...SUPPORTED_LANGUAGES],
    // Only `en`/`nl`: never try to fetch region variants like `nl-NL`.
    load: 'languageOnly',
    defaultNS: 'common',
    ns: [...NAMESPACES],
    interpolation: {
      escapeValue: false,
    },
    // Resources are awaited before the first render; a later language switch
    // re-renders once the new strings arrive instead of suspending the tree.
    react: { useSuspense: false },
    detection: {
      order: ['querystring', 'localStorage'],
      caches: ['localStorage'],
      lookupQuerystring: 'lang',
      lookupLocalStorage: 'bokito-language',
    },
  })

/** Switch language and resolve once its strings (and the fallback's) are loaded. */
export function ensureLanguage(language: string): Promise<unknown> {
  return i18n.changeLanguage(language)
}

export default i18n
