import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, BookOpen, FileText, Search } from 'lucide-react'
import MarkdownView from '../components/docs/MarkdownView'
import { formatAppDate } from '../lib/app-locale'
import {
  getHelpArticle,
  getHelpCenter,
  type HelpArticle,
  type HelpCenterIndex,
} from '../lib/help-api'

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
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
  }, [tenantSlug, articleSlug, t])

  const filtered = (index?.articles ?? []).filter((item) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return (
      item.title.toLowerCase().includes(q) || item.description.toLowerCase().includes(q)
    )
  })

  return (
    <div className="min-h-screen bg-background text-foreground">
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
            <div className="relative mt-4">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('helpPublic.search')}
                className="w-full rounded-lg border bg-background py-2.5 pl-9 pr-3 text-sm outline-none focus:border-primary"
              />
            </div>
          ) : null}
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8">
        {loading ? (
          <p className="text-sm text-muted-foreground">{t('helpPublic.loading')}</p>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : articleSlug && article ? (
          <article>
            <Link
              to={`/help/${tenantSlug}`}
              className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {t('helpPublic.allArticles')}
            </Link>
            <h1 className="text-2xl font-semibold tracking-tight">{article.title}</h1>
            <p className="mt-1 mb-6 text-xs text-muted-foreground">
              {t('helpPublic.updated', { date: formatDate(article.updated_at, i18n.language) })}
            </p>
            <MarkdownView content={article.content} />
          </article>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {query.trim() ? t('helpPublic.emptySearch') : t('helpPublic.empty')}
          </p>
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
    </div>
  )
}
