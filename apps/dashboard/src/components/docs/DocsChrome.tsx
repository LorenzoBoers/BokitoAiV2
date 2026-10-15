import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BookOpen, Check, ChevronDown, ChevronRight, Menu, Search } from 'lucide-react'
import {
  helpLang,
  searchProductHelp,
  type ProductHelpSearchResult,
} from '../../lib/product-help-api'
import { cn } from '../../lib/utils'
import { SearchField } from '../ui/search-field'
import { ThemeToggle } from '../ui/theme-toggle'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'

export const DOCS_LANG_KEY = 'bokito.docs.lang'

/** FilterChip look for router links and anchors in the docs chrome (FilterChip itself is a button). */
export function docsChipClass(active: boolean): string {
  return cn(
    'inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-xs font-medium transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--docs-accent)]',
    active
      ? 'bg-[var(--docs-fg)] text-[var(--docs-bg)]'
      : 'border border-[var(--docs-border)] text-[var(--docs-muted)] hover:border-[var(--docs-active-ring)] hover:text-[var(--docs-fg)]',
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
  onOpenNav?: () => void
}

export function DocsHeader({
  lang,
  setLang,
  activePage = 'docs',
  onOpenNav,
}: DocsHeaderProps) {
  const t = useDocsT(lang)
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      const typing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(true)
        return
      }
      if (event.key === '/' && !typing) {
        event.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <>
      <header className="docs-header z-20">
        <div className="flex h-14 w-full items-center gap-3 px-4 sm:px-6 lg:px-8">
          {onOpenNav ? (
            <button
              type="button"
              onClick={onOpenNav}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--docs-muted)] hover:bg-[var(--docs-hover)] hover:text-[var(--docs-fg)] lg:hidden"
              aria-label={t('docs.openNav')}
            >
              <Menu className="h-4 w-4" aria-hidden />
            </button>
          ) : null}

          <Link
            to="/docs"
            className="flex shrink-0 items-center gap-2.5 text-[0.95rem] font-semibold tracking-tight text-[var(--docs-fg)]"
          >
            <img
              src="/bokito-logo.png"
              alt=""
              className="h-7 w-7 shrink-0 rounded-md object-contain"
            />
            <span className="hidden items-center gap-1.5 sm:inline-flex">
              <BookOpen className="h-3.5 w-3.5 shrink-0 text-[var(--docs-muted)]" aria-hidden />
              <span>{t('docs.title')}</span>
            </span>
          </Link>

          <div className="mx-auto min-w-0 max-w-md flex-1">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="docs-search-trigger flex h-9 w-full items-center gap-2 px-3.5 text-left text-sm transition-colors"
            >
              <Search className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{t('docs.searchPlaceholder')}</span>
              <kbd className="hidden shrink-0 rounded-md bg-[var(--docs-kbd)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--docs-muted)] sm:inline">
                Ctrl+K
              </kbd>
            </button>
          </div>

          <nav className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            {/* Desktop only — on smaller viewports API lives in the side/drawer nav
                so the search field stays visible. */}
            {activePage === 'api' ? (
              <span className={cn(docsChipClass(true), 'hidden lg:inline-flex')} aria-current="page">
                {t('docs.apiReference')}
              </span>
            ) : (
              <Link to="/docs/api" className="docs-cta hidden lg:inline-flex">
                {t('docs.apiReference')}
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            )}
            {activePage === 'api' ? null : (
              <ThemeToggle className="h-8 w-8 !p-1.5 text-[var(--docs-muted)] hover:text-[var(--docs-fg)]" />
            )}
            <DocsLangPicker lang={lang} setLang={setLang} forcedDark={activePage === 'api'} />
          </nav>
        </div>
      </header>

      <DocsSearchDialog lang={lang} open={searchOpen} onOpenChange={setSearchOpen} />
    </>
  )
}

/** Circular UK flag (SVG — no emoji). */
function FlagEn({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <circle cx="12" cy="12" r="12" fill="#012169" />
      <path d="M3.5 4.2 20.5 19.8M20.5 4.2 3.5 19.8" stroke="#fff" strokeWidth="3.2" />
      <path d="M3.5 4.2 20.5 19.8M20.5 4.2 3.5 19.8" stroke="#C8102E" strokeWidth="1.6" />
      <path d="M12 0v24M0 12h24" stroke="#fff" strokeWidth="4.2" />
      <path d="M12 0v24M0 12h24" stroke="#C8102E" strokeWidth="2.2" />
    </svg>
  )
}

/** Circular NL flag (CSS stripes — no emoji, no clipPath id clashes). */
function FlagNl({ className }: { className?: string }) {
  return (
    <span
      className={cn('inline-block rounded-full', className)}
      style={{
        background:
          'linear-gradient(to bottom, #AE1C28 0 33.33%, #ffffff 33.33% 66.66%, #21468B 66.66% 100%)',
      }}
      aria-hidden
    />
  )
}

const DOCS_LANGS = [
  { value: 'en' as const, labelKey: 'docs.langEn', Flag: FlagEn },
  { value: 'nl' as const, labelKey: 'docs.langNl', Flag: FlagNl },
]

function DocsLangPicker({
  lang,
  setLang,
  forcedDark = false,
}: {
  lang: string
  setLang: (next: 'en' | 'nl') => void
  forcedDark?: boolean
}) {
  const t = useDocsT(lang)
  const current = helpLang(lang) as 'en' | 'nl'
  const active = DOCS_LANGS.find((item) => item.value === current) ?? DOCS_LANGS[0]
  const ActiveFlag = active.Flag

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex h-9 items-center gap-2 rounded-full border border-[var(--docs-border)] bg-transparent px-2.5 text-sm text-[var(--docs-fg)] transition-colors hover:border-[var(--docs-active-ring)] hover:bg-[var(--docs-hover)]"
          aria-label={t('docs.language')}
        >
          <ActiveFlag className="h-4 w-4 shrink-0 rounded-full ring-1 ring-white/15" />
          <span className="hidden font-medium sm:inline">{t(active.labelKey)}</span>
          <ChevronDown className="h-3.5 w-3.5 text-[var(--docs-muted)]" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className={cn(
          'docs-site min-w-[10.5rem] border-[var(--docs-border)] bg-[var(--docs-bg)] text-[var(--docs-fg)]',
          forcedDark && 'docs-api-forced-dark',
        )}
      >
        {DOCS_LANGS.map((item) => {
          const selected = item.value === current
          const Flag = item.Flag
          return (
            <DropdownMenuItem
              key={item.value}
              onSelect={() => setLang(item.value)}
              className="gap-2.5 focus:bg-[var(--docs-hover)] focus:text-[var(--docs-fg)]"
            >
              <Flag className="h-4 w-4 shrink-0 rounded-full ring-1 ring-white/15" />
              <span className="flex-1">{t(item.labelKey)}</span>
              {selected ? <Check className="h-3.5 w-3.5 text-[var(--docs-accent)]" aria-hidden /> : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function DocsSearchDialog({
  lang,
  open,
  onOpenChange,
}: {
  lang: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const t = useDocsT(lang)
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ProductHelpSearchResult[] | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      setQuery('')
      setResults(null)
      return
    }
    const handle = window.setTimeout(() => inputRef.current?.focus(), 20)
    return () => window.clearTimeout(handle)
  }, [open])

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
    }, 180)
    return () => window.clearTimeout(handle)
  }, [query, lang])

  function goTo(path: string) {
    onOpenChange(false)
    navigate(`/docs/${path}`)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="docs-site max-w-lg gap-0 overflow-hidden border-[var(--docs-border)] bg-[var(--docs-bg)] p-0 text-[var(--docs-fg)]">
        <DialogHeader className="sr-only">
          <DialogTitle>{t('docs.searchPlaceholder')}</DialogTitle>
        </DialogHeader>
        <div className="border-b border-[var(--docs-border)] px-3 py-2">
          <SearchField
            ref={inputRef}
            value={query}
            onChange={setQuery}
            placeholder={t('docs.searchPlaceholder')}
            autoFocus
          />
        </div>
        <div className="max-h-96 overflow-y-auto">
          {results === null ? (
            <p className="px-4 py-6 text-sm text-[var(--docs-muted)]">{t('docs.searchHint')}</p>
          ) : results.length === 0 ? (
            <p className="px-4 py-6 text-sm text-[var(--docs-muted)]">{t('docs.noResults')}</p>
          ) : (
            results.map((row) => (
              <button
                key={`${row.slug}:${row.heading}`}
                type="button"
                onClick={() => goTo(row.path)}
                className="block w-full border-b border-[var(--docs-border)] px-4 py-2.5 text-left last:border-b-0 hover:bg-[var(--docs-hover)]"
              >
                <p className="text-sm font-medium text-[var(--docs-fg)]">
                  {row.title}
                  {row.heading !== row.title ? (
                    <span className="text-[var(--docs-muted)]"> — {row.heading}</span>
                  ) : null}
                </p>
                <p className="mt-0.5 line-clamp-2 text-xs text-[var(--docs-muted)]">{row.snippet}</p>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
