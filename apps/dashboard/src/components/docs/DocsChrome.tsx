import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BookOpen, Search } from 'lucide-react'
import {
  helpLang,
  searchProductHelp,
  type ProductHelpSearchResult,
} from '../../lib/product-help-api'

export const DOCS_LANG_KEY = 'bokito.docs.lang'

export function useDocsLang(): [string, (next: 'en' | 'nl') => void] {
  const { i18n } = useTranslation()
  const [lang, setLangState] = useState<string>(() => {
    try {
      return helpLang(localStorage.getItem(DOCS_LANG_KEY) || i18n.language)
    } catch {
      return helpLang(i18n.language)
    }
  })
  const setLang = useCallback((next: 'en' | 'nl') => {
    setLangState(next)
    try {
      localStorage.setItem(DOCS_LANG_KEY, next)
    } catch {
      // storage unavailable; keep in-memory state
    }
  }, [])
  return [lang, setLang]
}

type DocsHeaderProps = {
  lang: string
  setLang: (next: 'en' | 'nl') => void
  /** Highlights the API reference pill when viewing /docs/api. */
  activePage?: 'docs' | 'api'
}

export function DocsHeader({ lang, setLang, activePage = 'docs' }: DocsHeaderProps) {
  const { t } = useTranslation('nav')
  const apiPillClass =
    'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors'
  return (
    <header className="z-20 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3.5">
        <Link
          to="/docs"
          className="flex items-center gap-2 text-[15px] font-semibold tracking-tight transition-colors hover:text-accent"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/12 text-accent">
            <BookOpen className="h-4 w-4" aria-hidden />
          </span>
          {t('docs.title')}
        </Link>
        <div className="min-w-0 flex-1">
          <DocsSearch lang={lang} />
        </div>
        <nav className="flex shrink-0 items-center gap-1.5">
          {activePage === 'api' ? (
            <span
              className={`${apiPillClass} border-accent/40 bg-accent/10 text-accent`}
              aria-current="page"
            >
              {t('docs.apiReference')}
            </span>
          ) : (
            <Link
              to="/docs/api"
              className={`${apiPillClass} border-border/70 hover:border-accent/40 hover:bg-accent/10 hover:text-accent`}
            >
              {t('docs.apiReference')}
            </Link>
          )}
          <div
            className="flex items-center rounded-full border border-border/70 p-0.5"
            role="group"
            aria-label="Language"
          >
            {(['en', 'nl'] as const).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLang(code)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase transition-colors ${
                  helpLang(lang) === code
                    ? 'bg-accent/15 text-accent'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {code}
              </button>
            ))}
          </div>
        </nav>
      </div>
    </header>
  )
}

function DocsSearch({ lang }: { lang: string }) {
  const { t } = useTranslation('nav')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ProductHelpSearchResult[] | null>(null)
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if (event.key === '/' && !typing) {
        event.preventDefault()
        inputRef.current?.focus()
      }
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [])

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults(null)
      return
    }
    const handle = window.setTimeout(() => {
      void searchProductHelp(q, lang)
        .then((rows) => setResults(rows))
        .catch(() => setResults([]))
    }, 200)
    return () => window.clearTimeout(handle)
  }, [query, lang])

  return (
    <div ref={boxRef} className="relative max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder={t('docs.searchPlaceholder')}
        className="w-full rounded-full border border-border/70 bg-muted/20 py-2 pl-9 pr-3 text-[13px] outline-none transition-[border-color,box-shadow] focus:border-accent/50 focus:shadow-[0_0_0_3px_rgb(var(--color-accent)/0.15)]"
      />
      {open && results !== null ? (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-96 overflow-y-auto rounded-lg border bg-background shadow-lg">
          {results.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-muted-foreground">{t('docs.noResults')}</p>
          ) : (
            results.map((row) => (
              <Link
                key={`${row.slug}:${row.heading}`}
                to={`/docs/${row.path}`}
                onClick={() => {
                  setOpen(false)
                  setQuery('')
                }}
                className="block border-b px-4 py-2.5 last:border-b-0 hover:bg-muted/50"
              >
                <p className="text-[13px] font-medium">
                  {row.title}
                  {row.heading !== row.title ? (
                    <span className="text-muted-foreground"> - {row.heading}</span>
                  ) : null}
                </p>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{row.snippet}</p>
              </Link>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}
