import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { detectLocale, translate, type Locale } from '../lib/copy'
import { loadLanguage, saveLanguage } from '../lib/storage'

type LocaleState = {
  locale: Locale
  t: (key: string, vars?: Record<string, string | number>) => string
  setLocale: (next: Locale) => void
}

const LocaleContext = createContext<LocaleState | null>(null)

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale())

  useEffect(() => {
    void loadLanguage().then((stored) => {
      if (stored) setLocaleState(stored)
    })
  }, [])

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    void saveLanguage(next)
  }, [])

  const value = useMemo<LocaleState>(
    () => ({
      locale,
      t: (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars),
      setLocale,
    }),
    [locale, setLocale],
  )

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useCopy(): LocaleState {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error('useCopy must be used within LocaleProvider')
  return ctx
}
