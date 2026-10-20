import { useTranslation } from 'react-i18next'
import { ExternalLink, MapPin, Repeat } from 'lucide-react'
import { ENTITY_ICONS } from '../../lib/entity-icons'
import { useAgents } from '../../hooks/useAgents'
import { useMembers } from '../../hooks/useMembers'
import { useTeams } from '../../hooks/useTeams'
import type { InboxThread } from '../../lib/inbox-api'
import { describeRepeat, parseServerTime, scheduleLongLabel } from '../../lib/thread-schedule'
import { formatAppTime } from '../../lib/app-locale'
import { SettingRow } from '../ui/entity-row'
import { controlTextClass } from '../ui/select'
import { cn } from '../../lib/utils'

const CalendarClock = ENTITY_ICONS.agenda

type Props = {
  thread: InboxThread
  /** Opens the planner for this thread. */
  onPlan?: () => void
  onChanged?: (thread: InboxThread | null) => void
}

/**
 * The thread's date and repeat: when it comes back, for whom, and what the
 * agent does then. Empty threads show a single "Plan" chip.
 */
export function ScheduleSection({ thread, onPlan }: Props) {
  const { t, i18n } = useTranslation('communication')
  const { members } = useMembers()
  const { teams } = useTeams()
  const { agents } = useAgents()
  const rule = thread.schedule ?? null
  const details = thread.scheduleDetails ?? {}
  const nextAt = rule?.nextRunAt ?? thread.nextAt
  const hasDate = Boolean(nextAt) || Boolean(rule)

  if (!hasDate) {
    if (!onPlan) return null
    return (
      <SettingRow label={t('schedule.title')}>
        <button type="button" onClick={onPlan} className={`${controlTextClass} text-text-secondary`}>
          <CalendarClock size={11} aria-hidden />
          <span className="truncate">{t('schedule.plan')}</span>
        </button>
      </SettingRow>
    )
  }

  const end = parseServerTime(thread.endsAt)
  const owner = thread.owner
  const ownerName =
    owner?.kind === 'user'
      ? (members.find((m) => m.uuid === owner.userId)?.name ?? null)
      : owner?.kind === 'team'
        ? (teams.find((team) => team.id === owner.teamId)?.name ?? null)
        : null
  const agentId = rule?.agentId ?? (owner?.kind === 'agent' ? owner.agentId : null)
  const agentName = agentId ? (agents.find((agent) => agent.id === agentId)?.name ?? null) : null
  const hiddenUntil = parseServerTime(thread.hiddenUntil)
  const paused = rule != null && !rule.enabled

  return (
    <section
      className={cn(
        'space-y-2 rounded-md border border-border/50 bg-bg-elevated px-3 py-2.5 text-left',
        onPlan && 'cursor-pointer transition-colors hover:border-border hover:bg-bg-hover',
      )}
      data-testid="thread-schedule"
      role={onPlan ? 'button' : undefined}
      tabIndex={onPlan ? 0 : undefined}
      onClick={onPlan}
      onKeyDown={(event) => {
        if (!onPlan) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onPlan()
        }
      }}
    >
      <div className="flex min-w-0 items-start gap-2">
        {rule?.repeat ? (
          <Repeat size={14} className="mt-0.5 shrink-0 text-text-muted" aria-hidden />
        ) : (
          <CalendarClock size={14} className="mt-0.5 shrink-0 text-text-muted" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-text-heading first-letter:uppercase">
            {paused
              ? t('schedule.paused')
              : nextAt
                ? `${scheduleLongLabel(nextAt, i18n.language)}${end ? ` - ${formatAppTime(end, i18n.language)}` : ''}`
                : t('schedule.noNextRun')}
          </p>
          {rule?.repeat ? (
            <p className="text-xs text-text-muted">{describeRepeat(rule.repeat, t, i18n.language)}</p>
          ) : null}
        </div>
      </div>

      {ownerName || agentName ? (
        <p className="text-xs text-text-secondary">
          {agentName
            ? t('schedule.agentWrites', { agent: agentName })
            : t('schedule.forRecipient', { recipient: ownerName })}
        </p>
      ) : null}

      {hiddenUntil ? (
        <p className="text-xs text-text-muted">
          {t('schedule.hiddenUntil', { when: scheduleLongLabel(thread.hiddenUntil, i18n.language) })}
        </p>
      ) : null}

      {rule?.instructions ? (
        <p className="line-clamp-3 whitespace-pre-line text-xs text-text-muted" title={rule.instructions}>
          {rule.instructions}
        </p>
      ) : details.note ? (
        <p className="line-clamp-3 whitespace-pre-line text-xs text-text-muted">{details.note}</p>
      ) : null}

      {details.location || details.htmlLink ? (
        <div className="flex flex-wrap items-center gap-3 text-xs text-text-muted">
          {details.location ? (
            <span className="inline-flex min-w-0 items-center gap-1">
              <MapPin size={11} aria-hidden />
              <span className="truncate">{details.location}</span>
            </span>
          ) : null}
          {details.htmlLink ? (
            <a
              href={details.htmlLink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-accent hover:underline"
              onClick={(event) => event.stopPropagation()}
            >
              <ExternalLink size={11} aria-hidden />
              {t('schedule.openInCalendar')}
            </a>
          ) : null}
        </div>
      ) : null}

      {rule?.lastStatus && rule.lastRunAt ? (
        <p className="text-2xs text-text-muted">
          {t('schedule.lastRun', {
            when: scheduleLongLabel(rule.lastRunAt, i18n.language),
            status: t(`schedule.status.${rule.lastStatus.split(':')[0]}`, { defaultValue: rule.lastStatus }),
          })}
        </p>
      ) : null}
    </section>
  )
}
