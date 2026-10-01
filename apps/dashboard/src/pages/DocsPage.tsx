import { useEffect, useMemo, useState } from 'react'
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
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'
import MarkdownView from '../components/docs/MarkdownView'
import ArticleFeedback from '../components/docs/ArticleFeedback'
import DocsScrollShell from '../components/docs/DocsScrollShell'
import { DocsHeader, useDocsLang } from '../components/docs/DocsChrome'
import {
  getProductHelpArticle,
  getProductHelpIndex,
  getProductHelpMarkdown,
  type ProductHelpArticle,
  type ProductHelpIndex,
  type ProductHelpSectionId,
} from '../lib/product-help-api'
import { extractToc } from '../lib/docs-toc'
import { applyDocsMeta } from '../lib/docs-seo'
import { readLastDocs, writeLastDocs } from '../lib/docs-continue'

const SECTION_ICONS: Record<ProductHelpSectionId, LucideIcon> = {
  'getting-started': Rocket,
  inbox: Inbox,
  ai: Bot,
  govern: ShieldCheck,
  integrations: Plug,
  developers: Code2,
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
    <DocsScrollShell header={<DocsHeader lang={lang} setLang={setLang} />}>
      {section && slug ? (
        <ArticleView key={`${slug}:${lang}`} slug={slug} section={section} lang={lang} index={index} />
      ) : (
        <Landing index={index} loadFailed={error} />
      )}
    </DocsScrollShell>
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
  const lastDocs = readLastDocs()

  return (
    <main className="relative mx-auto max-w-6xl px-6 pb-24">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-8 h-[28rem] overflow-hidden"
      >
        <div className="absolute left-1/2 top-0 h-[22rem] w-[42rem] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgb(var(--color-accent)/0.22),transparent_70%)] blur-2xl" />
        <div className="absolute left-[18%] top-24 h-40 w-40 rounded-full bg-[radial-gradient(circle,rgb(var(--color-accent)/0.14),transparent_70%)] blur-xl" />
        <div className="absolute right-[14%] top-16 h-48 w-48 rounded-full bg-[radial-gradient(circle,rgb(var(--color-accent)/0.1),transparent_70%)] blur-xl" />
      </div>

      <section className="relative py-16 text-center sm:py-20">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
          {t('docs.title')}
        </p>
        <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
          {t('docs.heroTitle')}
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-pretty text-[15px] leading-relaxed text-muted-foreground">
          {t('docs.heroBody')}
        </p>
        {lastDocs ? (
          <Link
            to={lastDocs.path}
            className="mt-7 inline-flex items-center gap-2 rounded-full border border-accent/35 bg-accent/10 px-4 py-2 text-[13px] font-medium text-accent transition-colors hover:bg-accent/15"
          >
            <span className="text-accent/70">{t('docs.continueLast')}</span>
            <span className="text-foreground">{lastDocs.title}</span>
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        ) : null}
      </section>

      <section className="relative grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {index.sections.map((section, i) => {
          const Icon = SECTION_ICONS[section.id] ?? BookOpen
          const first = section.articles[0]
          return (
            <Link
              key={section.id}
              to={first ? `/docs/${first.path}` : '/docs'}
              style={{ animationDelay: `${i * 40}ms` }}
              className="group relative overflow-hidden rounded-2xl border border-border/70 bg-background/60 p-5 shadow-sm transition-[transform,border-color,box-shadow,background-color] duration-200 hover:-translate-y-0.5 hover:border-accent/45 hover:bg-muted/25 hover:shadow-md"
            >
              <div
                aria-hidden
                className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-accent/0 transition-colors duration-200 group-hover:bg-accent/10"
              />
              <div className="flex items-center gap-3">
                <span className="rounded-xl border border-accent/20 bg-accent/10 p-2.5 text-accent transition-colors group-hover:bg-accent/15">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <h2 className="text-[15px] font-semibold tracking-tight">
                  {t(`docs.sections.${section.id}.title`)}
                </h2>
              </div>
              <p className="mt-3 text-[13px] leading-5 text-muted-foreground">
                {t(`docs.sections.${section.id}.blurb`)}
              </p>
              <p className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-accent">
                {t('docs.sectionCta', { count: section.articles.length })}
                <ChevronRight
                  className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
                  aria-hidden
                />
              </p>
            </Link>
          )
        })}
      </section>

      {popular.length > 0 ? (
        <section className="relative mt-14">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-accent/80">
            {t('docs.popular')}
          </h2>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {popular.map((item) => (
              <Link
                key={item.slug}
                to={`/docs/${item.path}`}
                className="group flex items-start gap-3 rounded-xl border border-transparent px-4 py-3.5 transition-colors hover:border-border/80 hover:bg-muted/35"
              >
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent opacity-80 transition-opacity group-hover:opacity-100">
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                </span>
                <span className="min-w-0">
                  <p className="text-[13px] font-medium text-foreground group-hover:text-accent">
                    {item.title}
                  </p>
                  <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{item.description}</p>
                </span>
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
        if (!cancelled) {
          setArticle(row)
          writeLastDocs(`/docs/${row.path}`, row.title)
        }
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
      <aside className="hidden w-56 shrink-0 self-start lg:block">
        <nav className="sticky top-0 max-h-[calc(100vh-4.5rem)] space-y-5 overflow-y-auto py-1 pr-1">
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
        <aside className="hidden w-48 shrink-0 self-start xl:block">
          <nav className="sticky top-0 max-h-[calc(100vh-4.5rem)] overflow-y-auto py-1">
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
