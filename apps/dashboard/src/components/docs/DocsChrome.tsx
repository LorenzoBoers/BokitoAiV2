import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BookOpen } from 'lucide-react'
import {
  helpLang,
  searchProductHelp,
  type ProductHelpSearchResult,
} from '../../lib/product-help-api'
import { cn } from '../../lib/utils'
import { SegmentedControl } from '../ui/segmented-control'
import { SearchField } from '../ui/search-field'

export const DOCS_LANG_KEY = 'bokito.docs.lang'

/** FilterChip look for router links and anchors in the docs chrome (FilterChip itself is a button). */
export function docsChipClass(active: boolean): string {
  return cn(
    'inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus',
    active
      ? 'bg-accent/12 text-accent'
      : 'bg-bg-hover/60 text-text-secondary hover:bg-bg-hover hover:text-text-heading',
  )
}

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

/** UI copy for the public docs site, keyed to the docs language switcher (not the app locale). */
export function useDocsT(lang: string) {
  const { i18n } = useTranslation()
  return useMemo(() => i18n.getFixedT(helpLang(lang), 'nav'), [i18n, lang])
}

type DocsHeaderProps = {
  lang: string
  setLang: (next: 'en' | 'nl') => void
  /** Highlights the API reference pill when viewing /docs/api. */
  activePage?: 'docs' | 'api'
}

export function DocsHeader({ lang, setLang, activePage = 'docs' }: DocsHeaderProps) {
  const t = useDocsT(lang)
  return (
    <header className="z-20 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3.5">
        <Link
          to="/docs"
          className="flex items-center gap-2 text-lg font-semibold tracking-tight transition-colors hover:text-accent"
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
            <span className={docsChipClass(true)} aria-current="page">
              {t('docs.apiReference')}
            </span>
          ) : (
            <Link to="/docs/api" className={docsChipClass(false)}>
              {t('docs.apiReference')}
            </Link>
          )}
          <SegmentedControl
            size="sm"
            aria-label={t('docs.language')}
            value={helpLang(lang) as 'en' | 'nl'}
            onChange={setLang}
            options={[
              { value: 'en', label: 'en' },
              { value: 'nl', label: 'nl' },
            ]}
          />
        </nav>
      </div>
    </header>
  )
}

function DocsSearch({ lang }: { lang: string }) {
  const t = useDocsT(lang)
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
      <SearchField
        ref={inputRef}
        value={query}
        onChange={(next) => {
          setQuery(next)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder={t('docs.searchPlaceholder')}
      />
      {open && results !== null ? (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-96 overflow-y-auto rounded-lg border bg-background shadow-overlay">
          {results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">{t('docs.noResults')}</p>
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
                <p className="text-sm font-medium">
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
