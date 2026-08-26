import { useEffect, useState } from 'react'
import { onGatewayStatus, type GatewayStatus } from '../lib/gateway'

export function useGatewayStatus(): GatewayStatus {
  const [status, setStatus] = useState<GatewayStatus>('disconnected')
  useEffect(() => onGatewayStatus(setStatus), [])
  return status
}
