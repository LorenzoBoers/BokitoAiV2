import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { announceNotification, ingestNotification } from '../context/NotificationContext'
import { onGatewayStatus, type GatewayEvent } from '../lib/gateway'
import { useLiveBus } from '../lib/live-store'
import { ingestAgentStatus, markAgentLiveRest } from './useAgentPresence'
import { ingestMemberPresence, setSelfPresenceContext, setSelfPresenceLive } from './useMembers'

/** Mounted once in the shell: every live table is fed from this one subscriber. */
export function useShellLiveBus() {
  const { token, user } = useAuth()
  const navigate = useNavigate()
  const userId = user?.uuid ?? null
  useEffect(() => {
    setSelfPresenceContext(userId)
    return () => setSelfPresenceContext(null)
  }, [userId])
  useEffect(() => onGatewayStatus((status) => {
    setSelfPresenceLive(status === 'connected' || status === 'connecting')
  }), [])
  useLiveBus(Boolean(token), {
    ingest: {
      presence: [ingestAgentStatus, ingestMemberPresence],
      agents: [ingestAgentStatus],
      notifications: [
        (event: GatewayEvent) => {
          ingestNotification(event, userId)
          announceNotification(event, userId, navigate)
        },
      ],
    },
    onDisconnect: markAgentLiveRest,
  })
}
