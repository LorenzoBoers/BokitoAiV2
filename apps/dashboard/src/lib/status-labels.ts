import type { TFunction } from 'i18next'
import { humanizeLabel } from './labels'

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

export function agendaStatusLabel(status: string | null | undefined, t: TFunction): string {
  return labelFromMap(status, t, 'status.agenda')
}

export function agendaKindLabel(kind: string | null | undefined, t: TFunction): string {
  return labelFromMap(kind, t, 'status.agendaKind')
}

export function agentRuntimeStatusLabel(status: string | null | undefined, t: TFunction): string {
  return labelFromMap(status, t, 'status.agentRuntime')
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
