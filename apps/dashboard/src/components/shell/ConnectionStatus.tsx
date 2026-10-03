import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { onGatewayStatus, type GatewayStatus } from '../../lib/gateway'
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

export default function ConnectionStatus({ showLabel = true }: { showLabel?: boolean }) {
  const { t } = useTranslation('nav')
  const status = useGatewayStatus()
  const label = t(`gateway.${status}`)
  const title =
    status === 'disconnected'
      ? t('gateway.reconnectHint')
      : t('gateway.title', { status: label })
  const body = (
    <>
      <span
        className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]} ${
          status === 'connected' || status === 'connecting' ? 'pulse-dot' : ''
        }`}
      />
      {showLabel ? label : null}
    </>
  )
  if (status === 'disconnected') {
    return (
      <Tip label={title}>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary"
        >
          {body}
          <span className="underline decoration-border/80 underline-offset-2">{t('gateway.reload')}</span>
        </button>
      </Tip>
    )
  }
  return (
    <Tip label={title}>
      <span className="inline-flex items-center gap-1.5 text-xs text-text-muted">{body}</span>
    </Tip>
  )
}
