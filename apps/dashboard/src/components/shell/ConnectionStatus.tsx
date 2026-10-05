import { useEffect, useState } from 'react'
import { AlertCircle, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { onGatewayStatus, type GatewayStatus } from '../../lib/gateway'
import { cn } from '../../lib/utils'
import { Tip } from '../ui/Tip'

const STATUS_DOT: Record<GatewayStatus, string> = {
  connected: 'bg-status-success',
  connecting: 'bg-status-warning',
  disconnected: 'bg-text-muted',
}

export function useGatewayStatus(): GatewayStatus {
  const [status, setStatus] = useState<GatewayStatus>('disconnected')
  useEffect(() => onGatewayStatus(setStatus), [])
  return status
}

export default function ConnectionStatus({
  showLabel = true,
  className,
  marker = 'dot',
}: {
  showLabel?: boolean
  className?: string
  /** `check` avoids a green presence-like dot (account menu). */
  marker?: 'dot' | 'check'
}) {
  const { t } = useTranslation('nav')
  const status = useGatewayStatus()
  const label = t(`gateway.${status}`)
  const title =
    status === 'disconnected'
      ? t('gateway.reconnectHint')
      : t('gateway.title', { status: label })
  const tone = className ?? 'text-xs text-text-muted'
  const mark =
    marker === 'check' ? (
      status === 'connected' ? (
        <Check size={11} strokeWidth={2.5} className="shrink-0 text-text-muted" aria-hidden />
      ) : (
        <AlertCircle
          size={11}
          strokeWidth={2.5}
          className={cn(
            'shrink-0',
            status === 'disconnected' ? 'text-status-error' : 'text-status-warning',
          )}
          aria-hidden
        />
      )
    ) : (
      <span
        className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]} ${
          status === 'connected' || status === 'connecting' ? 'pulse-dot' : ''
        }`}
      />
    )
  const body = (
    <>
      {mark}
      {showLabel ? label : null}
    </>
  )
  if (status === 'disconnected') {
    return (
      <Tip label={title}>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className={cn('inline-flex items-center gap-1.5 hover:text-text-primary', tone)}
        >
          {body}
          <span className="underline decoration-border/80 underline-offset-2">{t('gateway.reload')}</span>
        </button>
      </Tip>
    )
  }
  return (
    <Tip label={title}>
      <span className={cn('inline-flex items-center gap-1.5', tone)}>{body}</span>
    </Tip>
  )
}
