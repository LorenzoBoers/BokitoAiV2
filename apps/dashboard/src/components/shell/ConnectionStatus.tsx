import { useEffect, useState } from 'react'
import { onGatewayStatus, type GatewayStatus } from '../../lib/gateway'

const STATUS_LABEL: Record<GatewayStatus, string> = {
  connected: 'Connected',
  connecting: 'Connecting',
  disconnected: 'Offline',
}

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
  const status = useGatewayStatus()
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[11px] text-text-muted"
      title={`Gateway: ${STATUS_LABEL[status]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
      {showLabel ? STATUS_LABEL[status] : null}
    </span>
  )
}
