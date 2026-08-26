import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, BookOpen, Search } from 'lucide-react'
import { PageContent } from '../components/layout/PageContent'
import ContentHeader from '../components/shell/ContentHeader'
import MarkdownView from '../components/docs/MarkdownView'
import ArticleFeedback from '../components/docs/ArticleFeedback'
import {
  getProductHelpArticle,
  getProductHelpIndex,
  type ProductHelpArticle,
  type ProductHelpIndex,
} from '../lib/product-help-api'
import { isPageGuideSlug, PAGE_GUIDE_BACK, PAGE_GUIDE_RELATED, publicDocsPath } from '../lib/page-guides'

export default function LearnPage() {
  const { slug } = useParams<{ slug: string }>()
  return slug ? <LearnArticle slug={slug} /> : <LearnIndex />
}

function useLearnIndex() {
  const { i18n } = useTranslation()
  const [index, setIndex] = useState<ProductHelpIndex | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let cancelled = false
    setError(false)
    void getProductHelpIndex(i18n.language)
      .then((idx) => {
        if (!cancelled) setIndex(idx)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [i18n.language])
  return { index, error }
}

function LearnIndex() {
  const { t } = useTranslation('nav')
  const { index, error } = useLearnIndex()
  const [query, setQuery] = useState('')

  const sections = useMemo(() => {
    if (!index) return []
    const q = query.trim().toLowerCase()
    if (!q) return index.sections
    return index.sections
      .map((section) => ({
        ...section,
        articles: section.articles.filter(
          (item) =>
            item.title.toLowerCase().includes(q) ||
            item.description.toLowerCase().includes(q) ||
            item.intro.toLowerCase().includes(q) ||
            item.keywords.some((keyword) => keyword.toLowerCase().includes(q)),
        ),
      }))
      .filter((section) => section.articles.length > 0)
  }, [index, query])

  return (
    <PageContent width="md" className="space-y-6 py-1">
      <ContentHeader title={t('pageGuides.indexTitle')} subtitle={t('pageGuides.indexIntro')} />

      <div className="relative">
        <Search
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-muted"
          aria-hidden
        />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('pageGuides.search')}
          className="w-full rounded-lg border border-border/60 bg-bg-elevated/40 py-2 pl-9 pr-3 text-[13px] outline-none focus:border-accent/50"
        />
      </div>

      {error ? (
        <p className="text-[13px] text-status-error">{t('pageGuides.loadError')}</p>
      ) : !index ? (
        <p className="text-[13px] text-text-muted">{t('pageGuides.loading')}</p>
      ) : sections.length === 0 ? (
        <p className="text-[13px] text-text-muted">
          {query.trim() ? t('pageGuides.emptySearch') : t('pageGuides.empty')}
        </p>
      ) : (
        sections.map((section) => (
          <section key={section.id} className="space-y-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">
              {t(`docs.sections.${section.id}.title`)}
            </h2>
            <div className="space-y-2">
              {section.articles.map((item) => (
                <Link
                  key={item.slug}
                  to={`/learn/${item.slug}`}
                  className="block rounded-xl border border-border/60 px-4 py-3 transition-colors hover:border-accent/40 hover:bg-bg-hover/40"
                >
                  <p className="text-[13.5px] font-medium text-text-heading">{item.title}</p>
                  {item.description ? (
                    <p className="mt-0.5 line-clamp-2 text-[12.5px] text-text-muted">{item.description}</p>
                  ) : null}
                </Link>
              ))}
            </div>
          </section>
        ))
      )}

      <p className="text-[12px] text-text-muted">
        <Link to={publicDocsPath()} className="text-accent hover:underline">
          {t('pageGuides.publicLink')}
        </Link>
      </p>
    </PageContent>
  )
}

function LearnArticle({ slug }: { slug: string }) {
  const { t, i18n } = useTranslation('nav')
  const { index } = useLearnIndex()
  const [article, setArticle] = useState<ProductHelpArticle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const quickLinks = isPageGuideSlug(slug) ? PAGE_GUIDE_RELATED[slug] : []
  const backTo = isPageGuideSlug(slug) ? PAGE_GUIDE_BACK[slug] : '/learn'

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void getProductHelpArticle(slug, i18n.language)
      .then((row) => {
        if (!cancelled) setArticle(row)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error && err.message === 'NOT_FOUND' ? t('pageGuides.notFound') : t('pageGuides.loadError'))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [slug, i18n.language, t])

  const relatedArticles = (article?.related ?? [])
    .map((rel) => index?.articles.find((item) => item.slug === rel))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))

  return (
    <PageContent width="md" className="space-y-6 py-1">
      <ContentHeader
        title={article?.title || slug}
        subtitle={article?.intro || ''}
        meta={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={backTo}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-hover/60"
            >
              <ArrowLeft size={12} aria-hidden />
              {t('pageGuides.back')}
            </Link>
            <Link
              to="/learn"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-hover/60"
            >
              <BookOpen size={12} aria-hidden />
              {t('pageGuides.allArticles')}
            </Link>
          </div>
        }
      />

      <div className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-bg-elevated/40 px-4 py-4">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-text-heading">{t('pageGuides.getStartedTitle')}</p>
          <p className="mt-0.5 text-[12.5px] text-text-muted">{t('pageGuides.getStartedBody')}</p>
        </div>
        <Link
          to="/settings/setup"
          className="shrink-0 rounded-lg border border-border/60 px-3 py-1.5 text-[12px] font-medium text-accent transition-colors hover:bg-bg-hover/60"
        >
          {t('pageGuides.getStartedCta')}
        </Link>
      </div>

      {loading ? (
        <p className="text-[13px] text-text-muted">{t('pageGuides.loading')}</p>
      ) : error ? (
        <p className="text-[13px] text-status-error">{error}</p>
      ) : article ? (
        <MarkdownView content={article.content} />
      ) : null}

      {relatedArticles.length > 0 ? (
        <section className="rounded-xl border border-border/60 bg-bg-elevated/30 px-4 py-4">
          <p className="text-[13px] font-medium text-text-heading">{t('pageGuides.relatedArticlesTitle')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {relatedArticles.map((item) => (
              <Link
                key={item.slug}
                to={`/learn/${item.slug}`}
                className="rounded-lg border border-border/60 px-3 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:border-accent/40 hover:text-accent"
              >
                {item.title}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {quickLinks.length > 0 ? (
        <section className="rounded-xl border border-border/60 bg-bg-elevated/30 px-4 py-4">
          <p className="text-[13px] font-medium text-text-heading">{t('pageGuides.relatedTitle')}</p>
          <p className="mt-0.5 text-[12px] text-text-muted">{t('pageGuides.relatedBody')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {quickLinks.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="rounded-lg border border-border/60 px-3 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:border-accent/40 hover:text-accent"
              >
                {t(item.labelKey)}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {article ? <ArticleFeedback slug={article.slug} /> : null}

      <p className="text-[12px] text-text-muted">
        <Link to={publicDocsPath(article?.path)} className="text-accent hover:underline">
          {t('pageGuides.publicLink')}
        </Link>
      </p>
    </PageContent>
  )
}
