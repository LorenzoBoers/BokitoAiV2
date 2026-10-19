import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, ChevronRight, Copy, FileText } from 'lucide-react'
import MarkdownView from '../components/docs/MarkdownView'
import DocsSiteShell, { useDocsIndex } from '../components/docs/DocsSiteShell'
import DocsPageToc from '../components/docs/DocsPageToc'
import { DocsHeader, useDocsLang, useDocsT } from '../components/docs/DocsChrome'
import DocsScrollShell from '../components/docs/DocsScrollShell'
import { ArticleSkeleton, DocsShellSkeleton } from '../components/ui/skeleton'
import {
  getProductHelpArticle,
  getProductHelpMarkdown,
  productHelpMarkdownUrl,
  type ProductHelpArticle,
  type ProductHelpIndex,
} from '../lib/product-help-api'
import { extractToc } from '../lib/docs-toc'
import { applyDocsMeta } from '../lib/docs-seo'
import { readLastDocs, writeLastDocs } from '../lib/docs-continue'

/** Strip a leading `# Title` that duplicates the page H1. */
function articleBodyMarkdown(content: string, title: string): string {
  const trimmed = content.replace(/^\uFEFF?/, '').trimStart()
  const match = trimmed.match(/^#\s+(.+?)\s*\n+/)
  if (!match) return content
  if (match[1].trim().toLowerCase() !== title.trim().toLowerCase()) return content
  return trimmed.slice(match[0].length)
}

/** Public Bokito docs site. No login required. */
export default function DocsPage() {
  const { section, slug } = useParams<{ section?: string; slug?: string }>()
  const [lang, setLang] = useDocsLang()
  const { index, error } = useDocsIndex(lang)

  // Legacy flat URL /docs/{slug}: redirect to the canonical section path.
  if (!section && slug) {
    return (
      <LegacyRedirect
        slug={slug}
        index={index}
        loadFailed={error}
        lang={lang}
        setLang={setLang}
      />
    )
  }

  if (section && slug) {
    return (
      <ArticleView
        key={`${slug}:${lang}`}
        slug={slug}
        section={section}
        lang={lang}
        setLang={setLang}
        index={index}
      />
    )
  }

  return <Landing index={index} loadFailed={error} lang={lang} setLang={setLang} />
}

function LegacyRedirect({
  slug,
  index,
  loadFailed,
  lang,
  setLang,
}: {
  slug: string
  index: ProductHelpIndex | null
  loadFailed: boolean
  lang: string
  setLang: (next: 'en' | 'nl') => void
}) {
  const t = useDocsT(lang)
  if (loadFailed) return <Navigate to="/docs" replace />
  if (!index) {
    return (
      <DocsScrollShell
        className="docs-site flex h-dvh min-h-0 flex-col overflow-hidden"
        header={<DocsHeader lang={lang} setLang={setLang} />}
      >
        <div className="flex items-center justify-center px-6 py-16">
          <DocsShellSkeleton />
        </div>
      </DocsScrollShell>
    )
  }
  const article = index.articles.find((item) => item.slug === slug)
  return <Navigate to={article ? `/docs/${article.path}` : '/docs'} replace />
}

function Landing({
  index,
  loadFailed,
  lang,
  setLang,
}: {
  index: ProductHelpIndex | null
  loadFailed: boolean
  lang: string
  setLang: (next: 'en' | 'nl') => void
}) {
  const t = useDocsT(lang)

  useEffect(() => {
    return applyDocsMeta({ title: t('docs.title'), description: t('docs.heroBody') })
  }, [t])

  const startHere = index?.sections.find((s) => s.id === 'getting-started')?.articles ?? []
  const lastDocs = readLastDocs()

  return (
    <DocsSiteShell lang={lang} setLang={setLang} index={index} activePage="docs">
      {loadFailed ? (
        <p className="text-sm text-status-error">{t('docs.indexLoadError')}</p>
      ) : !index ? (
        <p className="text-sm text-[var(--docs-muted)]">{t('docs.indexLoading')}</p>
      ) : (
        <div className="pb-20">
          <p className="text-sm text-[var(--docs-muted)]">{t('docs.title')}</p>
          <h1 className="mt-3 text-balance text-4xl font-semibold tracking-tight text-[var(--docs-fg)] sm:text-5xl">
            {t('docs.heroTitle')}
          </h1>
          <p className="mt-5 max-w-2xl text-pretty text-[1.0625rem] leading-7 text-[var(--docs-subtle)]">
            {t('docs.heroBody')}
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            {startHere[0] ? (
              <Link to={`/docs/${startHere[0].path}`} className="docs-cta inline-flex">
                {startHere[0].title}
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            ) : null}
            <Link to="/docs/api" className="docs-cta-outline inline-flex">
              {t('docs.apiReference')}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>

          {lastDocs ? (
            <Link
              to={lastDocs.path}
              className="mt-6 inline-flex items-center gap-2 text-sm text-[var(--docs-muted)] hover:text-[var(--docs-fg)]"
            >
              <span>{t('docs.continueLast')}</span>
              <span className="text-[var(--docs-accent)]">{lastDocs.title}</span>
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          ) : null}

          <section className="mt-14 space-y-10">
            {index.sections.map((section) => (
              <div key={section.id}>
                <h2 className="text-lg font-semibold text-[var(--docs-fg)]">
                  {t(`docs.sections.${section.id}.title`)}
                </h2>
                <p className="mt-1.5 text-sm leading-6 text-[var(--docs-muted)]">
                  {t(`docs.sections.${section.id}.blurb`)}
                </p>
                <ul className="mt-4 space-y-1.5">
                  {section.articles.map((item) => (
                    <li key={item.slug}>
                      <Link
                        to={`/docs/${item.path}`}
                        className="group flex items-baseline gap-2 py-1 text-[0.9375rem] text-[var(--docs-subtle)] transition-colors hover:text-[var(--docs-fg)]"
                      >
                        <ChevronRight
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--docs-muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--docs-accent)]"
                          aria-hidden
                        />
                        <span>{item.title}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        </div>
      )}
    </DocsSiteShell>
  )
}

function ArticleView({
  slug,
  section,
  lang,
  setLang,
  index,
}: {
  slug: string
  section: string
  lang: string
  setLang: (next: 'en' | 'nl') => void
  index: ProductHelpIndex | null
}) {
  const t = useDocsT(lang)
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
          setError(
            err instanceof Error && err.message === 'NOT_FOUND'
              ? t('pageGuides.notFound')
              : t('pageGuides.loadError'),
          )
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
  const bodyMarkdown = useMemo(
    () => (article ? articleBodyMarkdown(article.content, article.title) : ''),
    [article],
  )
  const toc = useMemo(() => (bodyMarkdown ? extractToc(bodyMarkdown) : []), [bodyMarkdown])

  // Canonicalize a wrong-section URL once the article is known.
  if (article && article.section !== section) {
    return <Navigate to={`/docs/${article.path}`} replace />
  }

  async function copyForLlm() {
    if (!article) return
    const markdown = await getProductHelpMarkdown(article.slug, lang)
    const url = `${window.location.origin}/docs/${article.path}`
    await navigator.clipboard.writeText(`Source: ${url}\n\n${markdown}`)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  const right =
    article && !error ? (
      <DocsPageToc lang={lang} toc={toc} slug={article.slug} onCopyForLlm={copyForLlm} />
    ) : null

  return (
    <DocsSiteShell
      lang={lang}
      setLang={setLang}
      index={index}
      activeSlug={slug}
      activePage="docs"
      right={right}
    >
      {error ? (
        <>
          <Link
            to="/docs"
            className="mb-4 inline-flex items-center gap-1.5 text-sm text-[var(--docs-muted)] hover:text-[var(--docs-fg)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
            {t('docs.backToDocs')}
          </Link>
          <p className="text-sm text-status-error">{error}</p>
        </>
      ) : !article ? (
        <ArticleSkeleton />
      ) : (
        <article className="pb-20">
          <p className="text-sm text-[var(--docs-muted)]">
            {t(`docs.sections.${article.section}.title`)}
          </p>

          <h1 className="mt-3 text-balance text-4xl font-semibold tracking-tight text-[var(--docs-fg)] sm:text-[2.75rem] sm:leading-tight">
            {article.title}
          </h1>

          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2">
            <button type="button" onClick={() => void copyForLlm()} className="docs-util">
              {copied ? (
                <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
              ) : (
                <Copy className="h-3.5 w-3.5 shrink-0" aria-hidden />
              )}
              {copied ? t('docs.copyForLlmDone') : t('docs.copyForLlm')}
            </button>
            <a
              href={productHelpMarkdownUrl(article.slug, lang)}
              target="_blank"
              rel="noreferrer noopener"
              className="docs-util"
            >
              <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {t('docs.viewAsMarkdown')}
            </a>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link to="/docs/api" className="docs-cta inline-flex">
              {t('docs.apiReference')}
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
            <a
              href="/"
              className="docs-cta-outline inline-flex"
            >
              {t('docs.openApp')}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </a>
          </div>

          {article.intro ? (
            <p className="mt-8 text-[1.0625rem] leading-7 text-[var(--docs-subtle)]">{article.intro}</p>
          ) : null}

          <div className="mt-8 xl:hidden">
            <DocsPageToc
              lang={lang}
              toc={toc}
              slug={article.slug}
              onCopyForLlm={copyForLlm}
              compact
            />
          </div>

          <div className="docs-prose mt-10">
            <MarkdownView content={bodyMarkdown} />
          </div>

          {article.related.length > 0 && index ? (
            <section className="mt-14">
              <p className="text-sm font-medium text-[var(--docs-fg)]">
                {t('pageGuides.relatedArticlesTitle')}
              </p>
              <ul className="mt-4 grid gap-2.5 sm:grid-cols-2">
                {article.related.map((rel) => {
                  const target = index.articles.find((item) => item.slug === rel)
                  if (!target) return null
                  return (
                    <li key={rel}>
                      <Link
                        to={`/docs/${target.path}`}
                        className="docs-link-card group flex h-full items-start gap-2.5 rounded-xl px-3.5 py-3 transition-colors"
                      >
                        <ChevronRight
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--docs-muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--docs-accent)]"
                          aria-hidden
                        />
                        <span className="min-w-0 text-sm font-medium text-[var(--docs-fg)] group-hover:text-[var(--docs-accent)]">
                          {target.title}
                        </span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </section>
          ) : null}

          <nav className="mt-10 grid gap-3 sm:grid-cols-2">
            {previous ? (
              <Link
                to={`/docs/${previous.path}`}
                className="docs-link-card group flex min-w-0 flex-col gap-1.5 rounded-xl px-4 py-3.5 transition-colors"
              >
                <p className="flex items-center gap-1.5 text-xs text-[var(--docs-muted)]">
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
                  {t('docs.previous')}
                </p>
                <p className="text-sm font-medium text-[var(--docs-fg)] group-hover:text-[var(--docs-accent)]">
                  {previous.title}
                </p>
              </Link>
            ) : (
              <span className="hidden sm:block" aria-hidden />
            )}
            {next ? (
              <Link
                to={`/docs/${next.path}`}
                className="docs-link-card group flex min-w-0 flex-col items-end gap-1.5 rounded-xl px-4 py-3.5 text-right transition-colors"
              >
                <p className="flex items-center gap-1.5 text-xs text-[var(--docs-muted)]">
                  {t('docs.next')}
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </p>
                <p className="text-sm font-medium text-[var(--docs-fg)] group-hover:text-[var(--docs-accent)]">
                  {next.title}
                </p>
              </Link>
            ) : null}
          </nav>
        </article>
      )}
    </DocsSiteShell>
  )
}
