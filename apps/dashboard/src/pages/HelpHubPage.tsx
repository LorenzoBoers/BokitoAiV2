import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  BookOpen,
  Compass,
  ExternalLink,
  FileCode2,
  LifeBuoy,
  Mail,
  MessageSquare,
  Sparkles,
} from 'lucide-react'
import { PageContent } from '../components/layout/PageContent'
import { useTour } from '../components/tour/TourContext'
import { talkToAssistantPath } from '../lib/talk-to-assistant'

const SUPPORT_EMAIL = 'support@bokito.ai'

type HubLink = {
  key: string
  icon: React.ComponentType<{ size?: number; className?: string }>
  to?: string
  href?: string
  onClick?: () => void
  external?: boolean
}

export default function HelpHubPage() {
  const { t } = useTranslation('nav')
  const { start: startTour } = useTour()

  const guides: HubLink[] = [
    {
      key: 'setup',
      icon: Sparkles,
      to: '/settings/setup',
    },
    {
      key: 'tour',
      icon: Compass,
      onClick: () => startTour(),
    },
    {
      key: 'docs',
      icon: BookOpen,
      to: '/docs',
    },
    {
      key: 'api',
      icon: FileCode2,
      to: '/docs/api',
    },
  ]

  const support: HubLink[] = [
    {
      key: 'email',
      icon: Mail,
      href: `mailto:${SUPPORT_EMAIL}`,
      external: true,
    },
    {
      key: 'assistant',
      icon: MessageSquare,
      to: talkToAssistantPath(t('helpHub.assistantPrefill')),
    },
  ]

  return (
    <PageContent>
      <p className="mb-6 max-w-xl text-sm text-text-secondary">{t('helpHub.intro')}</p>

      <section className="mb-8">
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-text-muted">
          {t('helpHub.guidesTitle')}
        </h3>
        <ul className="divide-y divide-border/40 overflow-hidden rounded-xl border border-border/50 bg-bg-surface/40">
          {guides.map((item) => (
            <HubRow key={item.key} item={item} />
          ))}
        </ul>
      </section>

      <section>
        <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-accent">
          <LifeBuoy size={12} />
          {t('helpHub.supportTitle')}
        </h3>
        <p className="mb-2 max-w-xl text-xs text-text-muted">{t('helpHub.supportIntro')}</p>
        <ul className="divide-y divide-border/40 overflow-hidden rounded-xl border border-accent/25 bg-accent/5">
          {support.map((item) => (
            <HubRow key={item.key} item={item} />
          ))}
        </ul>
      </section>
    </PageContent>
  )
}

function HubRow({ item }: { item: HubLink }) {
  const { t } = useTranslation('nav')
  const Icon = item.icon
  const title = t(`helpHub.items.${item.key}.title`)
  const description = t(`helpHub.items.${item.key}.description`)
  const className =
    'flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-bg-hover/50'

  const body = (
    <>
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-bg-elevated text-accent">
        <Icon size={15} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[13px] font-medium text-text-heading">
          {title}
          {item.external ? <ExternalLink size={12} className="text-text-muted" /> : null}
        </span>
        <span className="mt-0.5 block text-[12px] text-text-muted">{description}</span>
      </span>
    </>
  )

  if (item.onClick) {
    return (
      <li>
        <button type="button" onClick={item.onClick} className={className}>
          {body}
        </button>
      </li>
    )
  }
  if (item.href) {
    return (
      <li>
        <a href={item.href} className={className}>
          {body}
        </a>
      </li>
    )
  }
  return (
    <li>
      <Link to={item.to ?? '/'} className={className}>
        {body}
      </Link>
    </li>
  )
}
