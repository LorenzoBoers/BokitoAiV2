import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { CalendarClock, ExternalLink, MapPin, Pause, Pencil, Play, Repeat, X, Zap } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useAgents } from '../../hooks/useAgents'
import { useMembers } from '../../hooks/useMembers'
import { useTeams } from '../../hooks/useTeams'
import type { InboxThread } from '../../lib/inbox-api'
import { clearThreadSchedule, runThreadSchedule, setThreadScheduleEnabled } from '../../lib/signals-api'
import { describeRepeat, parseServerTime, scheduleLongLabel } from '../../lib/thread-schedule'
import { formatAppTime } from '../../lib/app-locale'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { SettingRow } from '../ui/entity-row'
import { controlChipClass } from '../ui/select'

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
export function ScheduleSection({ thread, onPlan, onChanged }: Props) {
  const { t, i18n } = useTranslation('communication')
  const { token } = useAuth()
  const { members } = useMembers()
  const { teams } = useTeams()
  const { agents } = useAgents()
  const [busy, setBusy] = useState<'run' | 'toggle' | 'clear' | null>(null)
  const rule = thread.schedule ?? null
  const details = thread.scheduleDetails ?? {}
  const nextAt = rule?.nextRunAt ?? thread.nextAt
  const hasDate = Boolean(nextAt) || Boolean(rule)

  if (!hasDate) {
    if (!onPlan) return null
    return (
      <SettingRow label={t('schedule.title')}>
        <button type="button" onClick={onPlan} className={`${controlChipClass} text-text-secondary`}>
          <CalendarClock size={11} aria-hidden />
          <span className="truncate">{t('schedule.plan')}</span>
        </button>
      </SettingRow>
    )
  }

  const end = parseServerTime(thread.endsAt)
  const recipient = rule?.recipient
  const recipientName =
    recipient?.kind === 'user'
      ? (members.find((m) => m.uuid === recipient.id)?.name ?? null)
      : recipient?.kind === 'team'
        ? (teams.find((team) => team.id === recipient.id)?.name ?? null)
        : null
  const agentName = rule?.agentId ? (agents.find((agent) => agent.id === rule.agentId)?.name ?? null) : null
  const paused = rule != null && !rule.enabled

  async function act(kind: 'run' | 'toggle' | 'clear') {
    if (!token || busy) return
    setBusy(kind)
    try {
      if (kind === 'run') {
        await runThreadSchedule(token, String(thread.id))
        toast.success(t('schedule.runStarted'))
      } else if (kind === 'toggle' && rule) {
        onChanged?.(await setThreadScheduleEnabled(token, String(thread.id), !rule.enabled))
      } else if (kind === 'clear') {
        onChanged?.(await clearThreadSchedule(token, String(thread.id)))
        toast.success(t('schedule.cleared'))
      }
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('schedule.actionError')))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="space-y-2 rounded-lg border border-border/50 bg-bg-elevated/40 px-3 py-2.5" data-testid="thread-schedule">
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
        {onPlan ? (
          <button
            type="button"
            onClick={onPlan}
            className="shrink-0 rounded p-1 text-text-muted hover:bg-bg-hover hover:text-text-heading"
            aria-label={t('schedule.edit')}
            title={t('schedule.edit')}
          >
            <Pencil size={12} aria-hidden />
          </button>
        ) : null}
      </div>

      {recipientName || agentName ? (
        <p className="text-xs text-text-secondary">
          {agentName && recipientName
            ? t('schedule.agentWritesTo', { agent: agentName, recipient: recipientName })
            : agentName
              ? t('schedule.agentWrites', { agent: agentName })
              : t('schedule.forRecipient', { recipient: recipientName })}
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

      {token ? (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {rule?.agentId ? (
            <button type="button" className={controlChipClass} disabled={busy != null} onClick={() => void act('run')}>
              <Zap size={11} aria-hidden />
              {t('schedule.runNow')}
            </button>
          ) : null}
          {rule?.repeat ? (
            <button type="button" className={controlChipClass} disabled={busy != null} onClick={() => void act('toggle')}>
              {paused ? <Play size={11} aria-hidden /> : <Pause size={11} aria-hidden />}
              {paused ? t('schedule.resume') : t('schedule.pause')}
            </button>
          ) : null}
          <button
            type="button"
            className={`${controlChipClass} text-text-secondary`}
            disabled={busy != null}
            onClick={() => void act('clear')}
          >
            <X size={11} aria-hidden />
            {rule?.repeat ? t('schedule.stop') : t('schedule.clear')}
          </button>
        </div>
      ) : null}
    </section>
  )
}
