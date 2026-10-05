import type { TFunction } from 'i18next'
import { humanizeLabel } from './labels'
import { presenceLabel } from './presence'

function labelFromMap(
  value: string | null | undefined,
  t: TFunction,
  prefix: string,
  ns: string = 'communication',
): string {
  if (!value) return ''
  const key = `${prefix}.${String(value).trim().toLowerCase().replace(/-/g, '_')}`
  const translated = t(key, { ns, defaultValue: '' })
  if (translated) return translated
  return humanizeLabel(value)
}

export function threadStatusLabel(status: string | null | undefined, t: TFunction): string {
  return labelFromMap(status, t, 'status.thread')
}

export function contactStatusLabel(status: string | null | undefined, t: TFunction): string {
  return labelFromMap(status, t, 'status.contact')
}

export function mailboxStatusLabel(status: string | null | undefined, t: TFunction): string {
  return labelFromMap(status, t, 'status.mailbox')
}

/** One channel lifecycle label for the list, the hub sidebar, and the cockpit. */
export function channelStateLabel(state: string | null | undefined, t: TFunction): string {
  return labelFromMap(state, t, 'status.channel')
}

export function agendaStatusLabel(status: string | null | undefined, t: TFunction): string {
  return labelFromMap(status, t, 'status.agenda')
}

export function agendaKindLabel(kind: string | null | undefined, t: TFunction): string {
  return labelFromMap(kind, t, 'status.agendaKind')
}

/** Filters on Agenda (calendar is a source filter, not a kind chip). */
export const AGENDA_KIND_FILTERS = [
  'once',
  'event',
  'cron',
  'interval',
  'heartbeat',
  'webhook',
  'follow_up',
] as const

export function agentRuntimeStatusLabel(status: string | null | undefined, t: TFunction): string {
  return presenceLabel(status, t)
}

export function flowStatusLabel(enabled: boolean, t: TFunction): string {
  return enabled ? t('status.flow.active', { ns: 'communication' }) : t('status.flow.paused', { ns: 'communication' })
}

export function indexStatusLabel(status: string | null | undefined, t: TFunction): string {
  return labelFromMap(status, t, 'status.index')
}

export function workLogStatusLabel(status: string | null | undefined, t: TFunction): string {
  return labelFromMap(status, t, 'status.workLog')
}
