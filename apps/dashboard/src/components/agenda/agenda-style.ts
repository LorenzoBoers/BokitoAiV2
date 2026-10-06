import { cn } from '../../lib/utils'
import type { TFunction } from 'i18next'
import { Bell, Bot, CalendarDays, ClipboardCheck, History, Repeat, type LucideIcon } from 'lucide-react'
import { layerOf, type AgendaLayer } from '../../lib/agenda-layout'
import type { Trigger } from '../../lib/orchestration-api'
import type { TimeItem } from '../../lib/time-items'
import { timeAgo } from '../../lib/time-ago'

export const LAYER_ICON: Record<AgendaLayer, LucideIcon> = {
  calendar: CalendarDays,
  reminders: Bell,
  checkups: ClipboardCheck,
  agents: Bot,
  routines: Repeat,
  activity: History,
}

/** Swatch for rail toggles and list dots. */
export const LAYER_DOT: Record<AgendaLayer, string> = {
  calendar: 'bg-sky-500',
  reminders: 'bg-amber-500',
  checkups: 'bg-violet-500',
  agents: 'bg-accent',
  routines: 'bg-text-muted/60',
  activity: 'bg-emerald-500',
}

/** Block on the time grid: tinted fill, coloured left edge. */
export const LAYER_BLOCK: Record<AgendaLayer, string> = {
  calendar: 'border-sky-500/70 bg-sky-500/10 hover:bg-sky-500/20',
  reminders: 'border-amber-500/70 bg-amber-500/10 hover:bg-amber-500/20',
  checkups: 'border-violet-500/70 bg-violet-500/10 hover:bg-violet-500/20',
  agents: 'border-accent/70 bg-accent/10 hover:bg-accent/15',
  routines: 'border-border bg-bg-elevated hover:bg-bg-elevated/80',
  activity: 'border-emerald-500/60 bg-emerald-500/10 hover:bg-emerald-500/15',
}

/** Selected chip stays fully opaque even when the occurrence is in the past or paused. */
export function agendaChipState({
  selected,
  past,
  paused,
}: {
  selected: boolean
  past?: boolean
  paused?: boolean
}): string {
  if (selected) return 'z-10 bg-accent/15 ring-2 ring-accent opacity-100'
  return cn(past && 'opacity-60', paused && 'opacity-40')
}

export const LAYER_TEXT: Record<AgendaLayer, string> = {
  calendar: 'text-sky-600 dark:text-sky-400',
  reminders: 'text-amber-600 dark:text-amber-400',
  checkups: 'text-violet-600 dark:text-violet-400',
  agents: 'text-accent',
  routines: 'text-text-muted',
  activity: 'text-emerald-600 dark:text-emerald-400',
}

/** One line under the title: what happened or who is responsible. */
export function itemSubtitle(item: TimeItem, t: TFunction): string {
  const actor = item.actor_name || item.agent_name || t('agendaPage.someone')
  if (item.kind === 'activity') {
    const detail = item.detail || ''
    switch (item.status) {
      case 'filed':
        return t('agendaPage.activity.filed', { actor, detail })
      case 'stage':
        return t('agendaPage.activity.stage', { actor, detail })
      case 'assigned':
        return detail ? t('agendaPage.activity.assignedTo', { detail }) : t('agendaPage.activity.assigned')
      case 'closed':
        return t('agendaPage.activity.closed', { actor })
      case 'decision_asked':
        return t('agendaPage.activity.decisionAsked')
      case 'decision_answered':
        return t('agendaPage.activity.decisionAnswered', { actor })
      default:
        return actor
    }
  }
  if (item.kind === 'session') {
    return layerOf(item) === 'activity' ? t('agendaPage.activity.answered', { actor }) : actor
  }
  if (item.kind === 'calendar') {
    const names = item.calendars?.length ? item.calendars : [item.calendar_name || item.provider_label || '']
    return names.filter(Boolean).join(' · ')
  }
  if (item.owner_name) return t('agendaPage.ownedBy', { name: item.owner_name })
  return item.agent_name || ''
}

/** "in 20 min", "in 3 hours", "in 2 days", or the shared "5m ago" for the past. */
export function relativeMoment(atMs: number, nowMs: number, t: TFunction): string {
  const minutes = Math.round((atMs - nowMs) / 60_000)
  if (minutes < 0) return timeAgo(new Date(atMs).toISOString(), t)
  if (minutes < 1) return t('timeAgo.now')
  if (minutes < 60) return t('agendaPage.relative.inMinutes', { count: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return t('agendaPage.relative.inHours', { count: hours })
  return t('agendaPage.relative.inDays', { count: Math.round(hours / 24) })
}

export function isFailed(status: string): boolean {
  const s = status.toLowerCase()
  return s === 'failed' || s === 'error'
}

/** "every day", "every 2 hours", "on webhook" for a routine. */
export function triggerScheduleLabel(trigger: Pick<Trigger, 'kind' | 'cron_expr' | 'interval_minutes'>, t: TFunction): string {
  if (trigger.kind === 'webhook') return t('agendaPage.schedule.webhook')
  if (trigger.kind === 'cron') return trigger.cron_expr || t('agendaPage.schedule.unscheduled')
  if (trigger.kind === 'once' || trigger.kind === 'event') return t('agendaPage.kinds.once')
  const minutes = trigger.interval_minutes || 0
  if (minutes <= 0) return t('agendaPage.schedule.unscheduled')
  if (minutes % 1440 === 0) {
    const days = minutes / 1440
    return days === 1 ? t('agendaPage.schedule.everyDay') : t('agendaPage.schedule.everyDays', { count: days })
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60
    return hours === 1 ? t('agendaPage.schedule.everyHour') : t('agendaPage.schedule.everyHours', { count: hours })
  }
  return minutes === 1 ? t('agendaPage.schedule.everyMinute') : t('agendaPage.schedule.everyMinutes', { count: minutes })
}
