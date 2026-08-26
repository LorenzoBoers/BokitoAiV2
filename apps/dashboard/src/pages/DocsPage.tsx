import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Bot,
  Check,
  ChevronRight,
  Code2,
  Copy,
  Inbox,
  Plug,
  Rocket,
  Search,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'
import MarkdownView from '../components/docs/MarkdownView'
import ArticleFeedback from '../components/docs/ArticleFeedback'
import {
  getProductHelpArticle,
  getProductHelpIndex,
  getProductHelpMarkdown,
  searchProductHelp,
  type ProductHelpArticle,
  type ProductHelpIndex,
  type ProductHelpSearchResult,
  type ProductHelpSectionId,
  helpLang,
} from '../lib/product-help-api'
import { extractToc } from '../lib/docs-toc'
import { applyDocsMeta } from '../lib/docs-seo'

const DOCS_LANG_KEY = 'bokito.docs.lang'

const SECTION_ICONS: Record<ProductHelpSectionId, LucideIcon> = {
  'getting-started': Rocket,
  inbox: Inbox,
  ai: Bot,
  govern: ShieldCheck,
  integrations: Plug,
  developers: Code2,
}

function useDocsLang(): [string, (next: 'en' | 'nl') => void] {
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

function useDocsIndex(lang: string) {
  const [index, setIndex] = useState<ProductHelpIndex | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let cancelled = false
    setError(false)
    void getProductHelpIndex(lang)
      .then((idx) => {
        if (!cancelled) setIndex(idx)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [lang])
  return { index, error }
}

/** Public Bokito docs site. No login required. */
export default function DocsPage() {
  const { section, slug } = useParams<{ section?: string; slug?: string }>()
  const [lang, setLang] = useDocsLang()
  const { index, error } = useDocsIndex(lang)

  // Legacy flat URL /docs/{slug}: redirect to the canonical section path.
  if (!section && slug) {
    return <LegacyRedirect slug={slug} index={index} loadFailed={error} />
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <DocsHeader lang={lang} setLang={setLang} />
      {section && slug ? (
        <ArticleView key={`${slug}:${lang}`} slug={slug} section={section} lang={lang} index={index} />
      ) : (
        <Landing index={index} loadFailed={error} />
      )}
    </div>
  )
}

function LegacyRedirect({
  slug,
  index,
  loadFailed,
}: {
  slug: string
  index: ProductHelpIndex | null
  loadFailed: boolean
}) {
  const { t } = useTranslation('nav')
  if (loadFailed) return <Navigate to="/docs" replace />
  if (!index) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">{t('pageGuides.loading')}</p>
      </div>
    )
  }
  const article = index.articles.find((item) => item.slug === slug)
  return <Navigate to={article ? `/docs/${article.path}` : '/docs'} replace />
}

function DocsHeader({ lang, setLang }: { lang: string; setLang: (next: 'en' | 'nl') => void }) {
  const { t } = useTranslation('nav')
  return (
    <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3.5">
        <Link to="/docs" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
          <BookOpen className="h-4.5 w-4.5" aria-hidden />
          {t('docs.title')}
        </Link>
        <div className="min-w-0 flex-1">
          <DocsSearch lang={lang} />
        </div>
        <nav className="flex shrink-0 items-center gap-1.5">
          <Link
            to="/docs/api"
            className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-muted/50"
          >
            {t('docs.apiReference')}
          </Link>
          <div className="flex items-center rounded-lg border p-0.5" role="group" aria-label="Language">
            {(['en', 'nl'] as const).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLang(code)}
                className={`rounded-md px-2 py-1 text-[11px] font-semibold uppercase ${
                  helpLang(lang) === code ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
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
        className="w-full rounded-lg border bg-background py-2 pl-9 pr-3 text-[13px] outline-none focus:border-primary"
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

function Landing({ index, loadFailed }: { index: ProductHelpIndex | null; loadFailed: boolean }) {
  const { t } = useTranslation('nav')

  useEffect(() => {
    return applyDocsMeta({ title: t('docs.title'), description: t('docs.heroBody') })
  }, [t])

  if (loadFailed) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-16">
        <p className="text-sm text-destructive">{t('pageGuides.loadError')}</p>
      </main>
    )
  }
  if (!index) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-16">
        <p className="text-sm text-muted-foreground">{t('pageGuides.loading')}</p>
      </main>
    )
  }
  const popular = index.sections.find((s) => s.id === 'getting-started')?.articles ?? []

  return (
    <main className="mx-auto max-w-6xl px-6 pb-20">
      <section className="py-14 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">{t('docs.heroTitle')}</h1>
        <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">{t('docs.heroBody')}</p>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {index.sections.map((section) => {
          const Icon = SECTION_ICONS[section.id] ?? BookOpen
          const first = section.articles[0]
          return (
            <Link
              key={section.id}
              to={first ? `/docs/${first.path}` : '/docs'}
              className="group rounded-xl border p-5 transition-colors hover:border-primary/40 hover:bg-muted/30"
            >
              <div className="flex items-center gap-2.5">
                <span className="rounded-lg border bg-muted/40 p-2">
                  <Icon className="h-4 w-4 text-muted-foreground" aria-hidden />
                </span>
                <h2 className="text-sm font-semibold">{t(`docs.sections.${section.id}.title`)}</h2>
              </div>
              <p className="mt-2.5 text-[13px] leading-5 text-muted-foreground">
                {t(`docs.sections.${section.id}.blurb`)}
              </p>
              <p className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary">
                {t('docs.sectionCta', { count: section.articles.length })}
                <ChevronRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </p>
            </Link>
          )
        })}
      </section>

      {popular.length > 0 ? (
        <section className="mt-12">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('docs.popular')}
          </h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {popular.map((item) => (
              <Link
                key={item.slug}
                to={`/docs/${item.path}`}
                className="rounded-lg border px-4 py-3 transition-colors hover:bg-muted/40"
              >
                <p className="text-[13px] font-medium">{item.title}</p>
                <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{item.description}</p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  )
}

function ArticleView({
  slug,
  section,
  lang,
  index,
}: {
  slug: string
  section: string
  lang: string
  index: ProductHelpIndex | null
}) {
  const { t } = useTranslation('nav')
  const [article, setArticle] = useState<ProductHelpArticle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    setError(null)
    void getProductHelpArticle(slug, lang)
      .then((row) => {
        if (!cancelled) setArticle(row)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error && err.message === 'NOT_FOUND' ? t('pageGuides.notFound') : t('pageGuides.loadError'))
        }
      })
    return () => {
      cancelled = true
    }
  }, [slug, lang, t])

  useEffect(() => {
    if (!article) return
    return applyDocsMeta({
      title: `${article.title} - ${t('docs.title')}`,
      description: article.description,
    })
  }, [article, t])

  const flat = index?.articles ?? []
  const position = flat.findIndex((item) => item.slug === slug)
  const previous = position > 0 ? flat[position - 1] : null
  const next = position >= 0 && position < flat.length - 1 ? flat[position + 1] : null
  const toc = useMemo(() => (article ? extractToc(article.content) : []), [article])

  // Canonicalize a wrong-section URL once the article is known.
  if (article && article.section !== section) {
    return <Navigate to={`/docs/${article.path}`} replace />
  }

  async function copyMarkdown() {
    if (!article) return
    try {
      const markdown = await getProductHelpMarkdown(article.slug, lang)
      await navigator.clipboard.writeText(markdown)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard unavailable; nothing sensible to do.
    }
  }

  return (
    <main className="mx-auto flex max-w-6xl gap-10 px-6 py-8">
      <aside className="hidden w-56 shrink-0 lg:block">
        <nav className="sticky top-20 space-y-5">
          {(index?.sections ?? []).map((navSection) => (
            <div key={navSection.id}>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {t(`docs.sections.${navSection.id}.title`)}
              </p>
              <ul className="mt-1.5 space-y-0.5">
                {navSection.articles.map((item) => (
                  <li key={item.slug}>
                    <Link
                      to={`/docs/${item.path}`}
                      className={`block rounded-md px-2 py-1 text-[13px] ${
                        item.slug === slug
                          ? 'bg-muted font-medium text-foreground'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {item.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>

      <article className="min-w-0 flex-1 pb-16">
        {error ? (
          <>
            <Link to="/docs" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              {t('docs.backToDocs')}
            </Link>
            <p className="text-sm text-destructive">{error}</p>
          </>
        ) : !article ? (
          <p className="text-sm text-muted-foreground">{t('pageGuides.loading')}</p>
        ) : (
          <>
            <nav className="flex items-center gap-1.5 text-xs text-muted-foreground" aria-label="Breadcrumb">
              <Link to="/docs" className="hover:text-foreground">
                {t('docs.title')}
              </Link>
              <ChevronRight className="h-3 w-3" aria-hidden />
              <span>{t(`docs.sections.${article.section}.title`)}</span>
              <ChevronRight className="h-3 w-3" aria-hidden />
              <span className="text-foreground">{article.title}</span>
            </nav>

            <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold tracking-tight">{article.title}</h1>
                {article.intro ? <p className="mt-2 text-sm text-muted-foreground">{article.intro}</p> : null}
              </div>
              <button
                type="button"
                onClick={() => void copyMarkdown()}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              >
                {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                {copied ? t('docs.copied') : t('docs.copyMarkdown')}
              </button>
            </div>

            <div className="mt-6">
              <MarkdownView content={article.content} />
            </div>

            {article.related.length > 0 && index ? (
              <section className="mt-10 rounded-xl border px-4 py-4">
                <p className="text-sm font-medium">{t('pageGuides.relatedArticlesTitle')}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {article.related.map((rel) => {
                    const target = index.articles.find((item) => item.slug === rel)
                    if (!target) return null
                    return (
                      <Link
                        key={rel}
                        to={`/docs/${target.path}`}
                        className="rounded-lg border px-3 py-1.5 text-xs font-medium hover:bg-muted/50"
                      >
                        {target.title}
                      </Link>
                    )
                  })}
                </div>
              </section>
            ) : null}

            <div className="mt-8">
              <ArticleFeedback slug={article.slug} />
            </div>

            <nav className="mt-8 grid gap-3 sm:grid-cols-2">
              {previous ? (
                <Link to={`/docs/${previous.path}`} className="rounded-xl border p-4 transition-colors hover:bg-muted/40">
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <ArrowLeft className="h-3 w-3" aria-hidden />
                    {t('docs.previous')}
                  </p>
                  <p className="mt-1 text-[13px] font-medium">{previous.title}</p>
                </Link>
              ) : (
                <span />
              )}
              {next ? (
                <Link
                  to={`/docs/${next.path}`}
                  className="rounded-xl border p-4 text-right transition-colors hover:bg-muted/40"
                >
                  <p className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
                    {t('docs.next')}
                    <ArrowRight className="h-3 w-3" aria-hidden />
                  </p>
                  <p className="mt-1 text-[13px] font-medium">{next.title}</p>
                </Link>
              ) : null}
            </nav>
          </>
        )}
      </article>

      {toc.length > 1 ? (
        <aside className="hidden w-48 shrink-0 xl:block">
          <nav className="sticky top-20">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t('docs.onThisPage')}
            </p>
            <ul className="mt-2 space-y-1 border-l pl-3">
              {toc.map((item) => (
                <li key={item.id}>
                  <a href={`#${item.id}`} className="block text-[12.5px] text-muted-foreground hover:text-foreground">
                    {item.text}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
      ) : null}
    </main>
  )
}
