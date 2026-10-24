import { useEffect, useState } from 'react'
import { Button } from '../components/ui/button'
import { useTranslation } from 'react-i18next'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { BookOpen, Copy, FileText } from 'lucide-react'
import { toast } from 'sonner'
import MarkdownView from '../components/docs/MarkdownView'
import DocsScrollShell from '../components/docs/DocsScrollShell'
import { ArticleSkeleton } from '../components/ui/skeleton'
import { formatAppDate } from '../lib/app-locale'
import {
  getHelpArticle,
  getHelpCenter,
  type HelpArticle,
  type HelpCenterIndex,
} from '../lib/help-api'
import { parseHelpSearch } from '../lib/help-search-url'
import { SearchField } from '../components/ui/search-field'
import { TextLink } from '../components/ui/text-link'
import { PageHeader } from '../components/ui/page-header'

function formatDate(iso: string, language?: string | null): string {
  try {
    return formatAppDate(new Date(iso), language, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  } catch {
    return iso
  }
}

/** Public help center: published knowledge-base articles, no login required. */
export default function HelpCenter() {
  const { t, i18n } = useTranslation('nav')
  const { tenantSlug = '', articleSlug } = useParams<{
    tenantSlug: string
    articleSlug?: string
  }>()
  const [index, setIndex] = useState<HelpCenterIndex | null>(null)
  const [article, setArticle] = useState<HelpArticle | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const query = parseHelpSearch(searchParams.get('q'))
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadNonce, setReloadNonce] = useState(0)

  useEffect(() => {
    if (!tenantSlug) return
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        if (articleSlug) {
          const [idx, art] = await Promise.all([
            getHelpCenter(tenantSlug),
            getHelpArticle(tenantSlug, articleSlug),
          ])
          if (!cancelled) {
            setIndex(idx)
            setArticle(art)
          }
        } else {
          const idx = await getHelpCenter(tenantSlug)
          if (!cancelled) {
            setIndex(idx)
            setArticle(null)
          }
        }
      } catch (err) {
        if (!cancelled) {
          const raw = err instanceof Error ? err.message : ''
          setError(
            raw === 'NOT_FOUND'
              ? t('helpPublic.notFound')
              : raw && raw !== 'LOAD_FAILED'
                ? raw
                : t('helpPublic.loadError'),
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [tenantSlug, articleSlug, t, reloadNonce])

  const filtered = (index?.articles ?? []).filter((item) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return (
      item.title.toLowerCase().includes(q) || item.description.toLowerCase().includes(q)
    )
  })

  return (
    <DocsScrollShell
      header={
        <header className="border-b bg-muted/30">
          <div className="mx-auto max-w-3xl px-6 py-8">
            <Link
              to={`/help/${tenantSlug}`}
              className="flex items-center gap-2 text-lg font-semibold tracking-tight"
            >
              <BookOpen className="h-5 w-5" />
              {index ? t('helpPublic.titleNamed', { name: index.tenant.name }) : t('helpPublic.title')}
            </Link>
            {!articleSlug ? (
              <div className="mt-4">
                <SearchField
                  value={query}
                  onChange={(next) => {
                    const params = new URLSearchParams(searchParams)
                    if (next.trim()) params.set('q', next)
                    else params.delete('q')
                    setSearchParams(params, { replace: true })
                  }}
                  placeholder={t('helpPublic.search')}
                />
                <p className="mt-1.5 text-xs text-muted-foreground">{t('helpPublic.searchHint')}</p>
              </div>
            ) : null}
          </div>
        </header>
      }
    >
      <main className="mx-auto max-w-3xl px-6 py-8">
        {loading ? (
          <ArticleSkeleton />
        ) : error ? (
          <div className="space-y-3">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="secondary" size="xs"
              type="button"
              onClick={() => setReloadNonce((n) => n + 1)}
            >
              {t('helpPublic.retry')}
            </Button>
          </div>
        ) : articleSlug && article ? (
          <article>
            <PageHeader
              className="mb-6"
              back={{ to: `/help/${tenantSlug}`, label: t('helpPublic.allArticles') }}
              title={article.title}
              subtitle={
                <span className="flex flex-wrap items-center gap-3 text-xs">
                  <span>{t('helpPublic.updated', { date: formatDate(article.updated_at, i18n.language) })}</span>
                  <TextLink
                    onClick={() => {
                      void navigator.clipboard.writeText(window.location.href).then(
                        () => toast.success(t('helpPublic.copiedUrl')),
                        () => toast.error(t('helpPublic.copyFailed')),
                      )
                    }}
                  >
                    <Copy className="h-3 w-3" />
                    {t('helpPublic.copyUrl')}
                  </TextLink>
                </span>
              }
            />
            <MarkdownView content={article.content} />
          </article>
        ) : filtered.length === 0 ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {query.trim() ? t('helpPublic.emptySearch' /* design-system-ignore: publieke pagina met eigen skin, EmptyState gebruikt app-tokens */) : t('helpPublic.empty' /* design-system-ignore: publieke pagina met eigen skin, EmptyState gebruikt app-tokens */)}
            </p>
            {query.trim() ? (
              <TextLink
                type="button"
                className="text-sm"
                onClick={() => {
                  const params = new URLSearchParams(searchParams)
                  params.delete('q')
                  setSearchParams(params, { replace: true })
                }}
              >
                {t('helpPublic.clearSearch')}
              </TextLink>
            ) : (
              <p className="text-xs text-muted-foreground">{t('helpPublic.emptyIndexHint')}</p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((item) => (
              <Link
                key={item.slug}
                to={`/help/${tenantSlug}/${item.slug}`}
                className="block rounded-lg border p-4 transition-colors hover:bg-muted/50"
              >
                <div className="flex items-start gap-3">
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <h2 className="text-sm font-medium">{item.title}</h2>
                    {item.description ? (
                      <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                        {item.description}
                      </p>
                    ) : null}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </DocsScrollShell>
  )
}
