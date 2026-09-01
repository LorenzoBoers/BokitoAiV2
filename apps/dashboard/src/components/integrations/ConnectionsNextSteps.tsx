import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CalendarDays, Mail, Puzzle } from 'lucide-react'
import { connectedPathWithKind } from '../../lib/integration-kind-url'

type Props = {
  needsChannel: boolean
  needsAgenda: boolean
  needsModule: boolean
}

export function ConnectionsNextSteps({ needsChannel, needsAgenda, needsModule }: Props) {
  const { t } = useTranslation('nav')
  if (!needsChannel && !needsAgenda && !needsModule) return null

  const steps = [
    needsChannel
      ? {
          key: 'channel',
          to: '/settings/channels',
          icon: Mail,
          label: t('integrations.connected.nextChannel'),
        }
      : null,
    needsAgenda
      ? {
          key: 'agenda',
          to: `${connectedPathWithKind('calendar')}#catalog`,
          icon: CalendarDays,
          label: t('integrations.connected.nextAgenda'),
        }
      : null,
    needsModule
      ? {
          key: 'module',
          to: '/modules',
          icon: Puzzle,
          label: t('integrations.connected.nextModule'),
        }
      : null,
  ].filter((step): step is NonNullable<typeof step> => step != null)

  return (
    <section className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-text-muted">
        {t('integrations.connected.nextTitle')}
      </h2>
      <div className="flex flex-wrap gap-2">
        {steps.map((step) => {
          const Icon = step.icon
          return (
            <Link
              key={step.key}
              to={step.to}
              className="inline-flex items-center gap-2 rounded-lg border border-border/60 bg-bg-surface px-3 py-2 text-sm text-text-heading hover:border-border hover:bg-bg-hover/40"
            >
              <Icon size={14} className="text-text-muted" aria-hidden />
              {step.label}
            </Link>
          )
        })}
      </div>
    </section>
  )
}
