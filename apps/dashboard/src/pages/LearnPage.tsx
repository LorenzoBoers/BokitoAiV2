import { Link, Navigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, CircleHelp } from 'lucide-react'
import { PageContent } from '../components/layout/PageContent'
import ContentHeader from '../components/shell/ContentHeader'
import {
  isPageGuideSlug,
  PAGE_GUIDE_BACK,
  PAGE_GUIDE_RELATED,
  type PageGuideSlug,
} from '../lib/page-guides'

type GuideSection = { title: string; body: string }

function readSections(raw: unknown): GuideSection[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    if (typeof row.title !== 'string' || typeof row.body !== 'string') return []
    return [{ title: row.title, body: row.body }]
  })
}

export default function LearnPage() {
  const { t } = useTranslation('nav')
  const { slug } = useParams<{ slug: string }>()

  if (!isPageGuideSlug(slug)) {
    return <Navigate to="/cockpit" replace />
  }

  return <LearnArticle slug={slug} />
}

function LearnArticle({ slug }: { slug: PageGuideSlug }) {
  const { t } = useTranslation('nav')
  const sections = readSections(t(`pageGuides.${slug}.sections`, { returnObjects: true }))
  const related = PAGE_GUIDE_RELATED[slug]

  return (
    <PageContent width="md" className="space-y-6 py-1">
      <ContentHeader
        title={t(`pageGuides.${slug}.pageTitle`)}
        subtitle={t(`pageGuides.${slug}.intro`)}
        meta={
          <Link
            to={PAGE_GUIDE_BACK[slug]}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-1.5 text-[12px] font-medium text-text-secondary transition-colors hover:bg-bg-hover/60"
          >
            <ArrowLeft size={12} aria-hidden />
            {t('pageGuides.back')}
          </Link>
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

      <div className="space-y-5">
        {sections.map((section) => (
          <section key={section.title} className="space-y-1.5">
            <h2 className="flex items-center gap-2 text-[14px] font-semibold text-text-heading">
              <CircleHelp size={14} className="text-accent" aria-hidden />
              {section.title}
            </h2>
            <p className="text-[13.5px] leading-relaxed text-text-secondary">{section.body}</p>
          </section>
        ))}
      </div>

      {related.length > 0 ? (
        <section className="rounded-xl border border-border/60 bg-bg-elevated/30 px-4 py-4">
          <p className="text-[13px] font-medium text-text-heading">{t('pageGuides.relatedTitle')}</p>
          <p className="mt-0.5 text-[12px] text-text-muted">{t('pageGuides.relatedBody')}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {related.map((item) => (
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
    </PageContent>
  )
}
