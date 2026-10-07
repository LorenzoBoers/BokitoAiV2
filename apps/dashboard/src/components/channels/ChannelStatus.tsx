import { useTranslation } from 'react-i18next'
import { AlertTriangle, Check, Circle, Mail, MessageSquare, MinusCircle, XCircle } from 'lucide-react'
import ProviderLogo from '../email/ProviderLogo'
import { BrandMark } from '../integrations/BrandMark'
import { formatAppDateTime } from '../../lib/app-locale'
import { channelStateLabel } from '../../lib/status-labels'
import { cn } from '../../lib/utils'
import type { ChannelCheck, ChannelCheckState, ChannelRow, ChannelState } from '../../lib/channels-api'
import type { Provider } from '../../lib/email-oauth'

const STATE_DOT: Record<ChannelState, string> = {
  active: 'bg-status-success',
  connecting: 'bg-status-info',
  degraded: 'bg-status-warning',
  setup_required: 'bg-status-warning',
  action_required: 'bg-status-error',
  error: 'bg-status-error',
  paused: 'bg-text-muted/60',
  archived: 'bg-text-muted/30',
}

/** The one channel state: a dot and a word, same in the list and the hub. */
export function ChannelStatus({ state, className }: { state: ChannelState; className?: string }) {
  const { t } = useTranslation('communication')
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 text-xs font-medium text-text-secondary', className)}
      data-testid="channel-state"
      data-state={state}
    >
      <span className={cn('h-2 w-2 shrink-0 rounded-full', STATE_DOT[state] ?? 'bg-text-muted')} aria-hidden />
      {channelStateLabel(state, t)}
    </span>
  )
}

export function ChannelIcon({ row }: { row: ChannelRow }) {
  if (row.kind === 'email_mailbox') {
    return <ProviderLogo provider={row.provider as Provider} className="h-5 w-5 shrink-0 object-contain" />
  }
  if (row.kind === 'email_relay') {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-accent/10 text-accent">
        <Mail size={13} />
      </span>
    )
  }
  if (row.kind === 'whatsapp') return <BrandMark slug="whatsapp" />
  if (row.kind === 'slack') return <BrandMark slug="slack" />
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-bg-elevated text-text-secondary">
      <MessageSquare size={13} />
    </span>
  )
}

const CHECK_ICONS: Record<ChannelCheckState, typeof Check> = {
  ok: Check,
  warn: AlertTriangle,
  fail: XCircle,
  pending: Circle,
  na: MinusCircle,
}

const CHECK_COLORS: Record<ChannelCheckState, string> = {
  ok: 'text-status-success',
  warn: 'text-status-warning',
  fail: 'text-status-error',
  pending: 'text-text-muted',
  na: 'text-text-muted',
}

const ISO_DETAIL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

export function CheckLine({ check }: { check: ChannelCheck }) {
  const { t, i18n } = useTranslation('nav')
  const Icon = CHECK_ICONS[check.state] ?? Circle
  const label = t(`channelsPage.checks.${check.id}`, { defaultValue: check.id.replace(/_/g, ' ') })
  const detail = ISO_DETAIL.test(check.detail)
    ? formatAppDateTime(new Date(check.detail), i18n.language)
    : check.detail
  return (
    <li className="flex items-start gap-2 text-xs">
      <Icon size={13} className={`mt-0.5 shrink-0 ${CHECK_COLORS[check.state]}`} aria-hidden />
      <span className="min-w-0">
        <span className="text-text-secondary">{label}</span>
        <span className="text-text-muted"> · {t(`channelsPage.checkState.${check.state}`)}</span>
        {detail ? (
          <span className="block truncate-fade text-text-muted" title={detail}>
            {detail}
          </span>
        ) : null}
      </span>
    </li>
  )
}
