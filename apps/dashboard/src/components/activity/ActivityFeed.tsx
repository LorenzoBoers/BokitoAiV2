import type { ComponentType, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { AlertCircle, Bot, CheckCircle2, CircleDot, Loader2, Sparkles, UserRound, Wrench } from 'lucide-react'
import type { ActivityEntry } from '../../hooks/useActivityFeed'
import { activityEventMessage, activityEventTypeLabel } from '../../lib/activity-labels'
import { activityDayBucket } from '../../lib/activity-day'
import { formatAppDate } from '../../lib/app-locale'
import { activityEntryPath } from '../../lib/open-entity'
import { cn } from '../../lib/utils'

type Tone = 'ok' | 'error' | 'progress' | 'human' | 'muted'

function toneFor(entry: ActivityEntry): Tone {
  if (entry.kind === 'audit') return 'human'
  const key = `${entry.eventType} ${entry.message}`.toLowerCase()
  if (/fail|error|cancel/.test(key)) return 'error'
  if (/complet|done|approved|sent|result/.test(key)) return 'ok'
  if (entry.live || /start|running|tool|think/.test(key)) return 'progress'
  return 'muted'
}

const TONE_DOT: Record<Tone, string> = {
  ok: 'bg-status-success',
  error: 'bg-status-error',
  progress: 'bg-sky-500',
  human: 'bg-amber-500',
  muted: 'bg-border',
}

const TONE_ICON_BG: Record<Tone, string> = {
  ok: 'bg-status-success/12 text-status-success',
  error: 'bg-status-error/12 text-status-error',
  progress: 'bg-sky-500/12 text-sky-600 dark:text-sky-400',
  human: 'bg-amber-500/12 text-amber-700 dark:text-amber-300',
  muted: 'bg-bg-hover text-text-muted',
}

function iconFor(entry: ActivityEntry, tone: Tone): ComponentType<{ size?: number; className?: string }> {
  if (entry.kind === 'audit') return UserRound
  const key = `${entry.eventType} ${entry.message}`.toLowerCase()
  if (/fail|error|cancel/.test(key)) return AlertCircle
  if (/complet|done|approved|sent|result/.test(key)) return CheckCircle2
  if (/tool|lookup|search|opzoek/.test(key)) return Wrench
  if (/think|nadenk|spark|decision/.test(key)) return Sparkles
  if (tone === 'progress' || entry.live) return Loader2
  if (entry.agentId) return Bot
  return CircleDot
}

function clock(iso: string): string {
  const d = new Date(iso.endsWith('Z') || iso.includes('+') ? iso : `${iso}Z`)
  if (Number.isNaN(d.getTime())) return '--:--'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

function RowLink({ to, className, children }: { to: string | null; className: string; children: ReactNode }) {
  return to ? (
    <Link to={to} className={className}>
      {children}
    </Link>
  ) : (
    <div className={className}>{children}</div>
  )
}

/** Agent and human activity as a timeline with day separators. */
export function ActivityFeed({
  entries,
  agentNames,
  empty,
}: {
  entries: ActivityEntry[]
  agentNames?: Map<string, string>
  empty?: ReactNode
}) {
  const { t, i18n } = useTranslation('nav')
  if (entries.length === 0) return <>{empty ?? null}</>

  const actorOf = (entry: ActivityEntry) =>
    entry.actorName ||
    (entry.agentId ? agentNames?.get(entry.agentId) : null) ||
    (entry.kind === 'audit' ? t('activityPage.teamMember') : t('activityPage.system'))

  return (
    <ol className="relative m-0 list-none p-0">
      {entries.map((entry, index) => {
        const day = activityDayBucket(entry.createdAt)
        const prevDay = index > 0 ? activityDayBucket(entries[index - 1]!.createdAt) : null
        const tone = toneFor(entry)
        const Icon = iconFor(entry, tone)
        const label = activityEventTypeLabel(entry.eventType, t) || entry.eventType
        const message = activityEventMessage(entry.message, t) || label
        const target = activityEntryPath(entry)
        const isLast = index === entries.length - 1
        return (
          <li key={entry.id} className="relative">
            {day !== prevDay ? (
              <div className="sticky top-0 z-10 mb-3 mt-1 flex justify-center first:mt-0">
                <span className="rounded-md border border-border/50 bg-bg-elevated px-3 py-0.5 text-xs font-medium text-text-secondary">
                  {day === 'today'
                    ? t('activityPage.dayToday')
                    : day === 'yesterday'
                      ? t('activityPage.dayYesterday')
                      : formatAppDate(new Date(entry.createdAt), i18n.language)}
                </span>
              </div>
            ) : null}
            <div className="flex gap-3">
              <div className="relative flex w-9 shrink-0 flex-col items-center">
                {!isLast ? <span aria-hidden className="absolute top-9 bottom-0 w-px bg-border/70" /> : null}
                <span
                  className={cn(
                    'relative z-[1] flex h-8 w-8 items-center justify-center rounded-full border border-border/40',
                    TONE_ICON_BG[tone],
                  )}
                >
                  <Icon size={14} className={entry.live && tone === 'progress' ? 'animate-spin' : undefined} />
                </span>
              </div>
              <RowLink
                to={target}
                className={cn(
                  'mb-3 block min-w-0 flex-1 rounded-lg border border-transparent px-3 py-2.5 text-left transition-colors',
                  target ? 'hover:border-border/60 hover:bg-bg-hover/50' : 'cursor-default',
                )}
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-xs tabular-nums text-text-muted">{clock(entry.createdAt)}</span>
                  <span className="text-sm font-medium text-text-primary">{actorOf(entry)}</span>
                  {entry.live ? (
                    <span className="inline-flex items-center gap-1 text-2xs font-medium text-status-success">
                      <span className={cn('h-1.5 w-1.5 rounded-full', TONE_DOT[tone])} />
                      {t('activityPage.live')}
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-sm font-medium text-text-secondary">{label}</p>
                {message !== label ? <p className="mt-0.5 line-clamp-2 text-sm text-text-muted">{message}</p> : null}
              </RowLink>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
