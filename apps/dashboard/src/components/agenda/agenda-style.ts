import type { CSSProperties } from 'react'
import { cn } from '../../lib/utils'
import type { TFunction } from 'i18next'
import { Bot, CalendarDays, ClipboardList, History, type LucideIcon } from 'lucide-react'
import { layerOf, type AgendaLayer } from '../../lib/agenda-layout'
import { statusTone } from '../../lib/badge-tones'
import type { Trigger } from '../../lib/orchestration-api'
import type { TimeItem } from '../../lib/time-items'
import { timeAgo } from '../../lib/time-ago'
import type { BadgeTone } from '../ui/badge'

export type AgendaVisualLayer = AgendaLayer | 'calendar'

export const LAYER_ICON: Record<AgendaVisualLayer, LucideIcon> = {
  calendar: CalendarDays,
  tasks: ClipboardList,
  activity: History,
}

/** Swatch for rail toggles and list dots. */
export const LAYER_DOT: Record<AgendaVisualLayer, string> = {
  calendar: 'bg-status-info',
  tasks: 'bg-accent',
  activity: 'bg-status-success',
}

/** Calendar events take their provider calendar colour over the layer swatch. */
export function itemDotStyle(item: TimeItem): CSSProperties | undefined {
  return item.kind === 'calendar' && item.calendar_color ? { backgroundColor: item.calendar_color } : undefined
}

/** Block on the time grid: tinted fill, coloured left edge. */
export const LAYER_BLOCK: Record<AgendaVisualLayer, string> = {
  calendar: 'border-status-info/70 bg-status-info/10 hover:bg-status-info/20',
  tasks: 'border-accent/70 bg-accent/10 hover:bg-accent/15',
  activity: 'border-status-success/60 bg-status-success/10 hover:bg-status-success/15',
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

export const LAYER_TEXT: Record<AgendaVisualLayer, string> = {
  calendar: 'text-status-info',
  tasks: 'text-accent',
  activity: 'text-status-success',
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
  if (item.agent_name || item.actor_name) return actor
  return ''
}

export function visualLayerOf(item: TimeItem): AgendaVisualLayer {
  return layerOf(item)
}

/** Fallback icon when LAYER_ICON lookup needs a Bot for agent wakes. */
export function itemIcon(item: TimeItem): LucideIcon {
  const layer = layerOf(item)
  if (layer === 'tasks' && (item.kind === 'wake' || item.kind === 'session')) return Bot
  return LAYER_ICON[layer]
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

/** Soft pill tone for Agenda statuses (panel, list, group rows). */
export function agendaStatusTone(status: string | null | undefined): BadgeTone {
  return statusTone(status)
}

/** "every day", "every 2 hours", "on webhook" for a routine. */
export function triggerScheduleLabel(
  trigger: Pick<Trigger, 'kind' | 'cron_expr' | 'interval_minutes'>,
  t: TFunction,
): string {
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
  return minutes === 1
    ? t('agendaPage.schedule.everyMinute')
    : t('agendaPage.schedule.everyMinutes', { count: minutes })
}
