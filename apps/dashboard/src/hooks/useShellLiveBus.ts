import { useAuth } from '../context/AuthContext'
import { ingestNotification } from '../context/NotificationContext'
import type { GatewayEvent } from '../lib/gateway'
import { useLiveBus } from '../lib/live-store'
import { ingestAgentStatus, markAgentLiveRest } from './useAgentPresence'
import { ingestMemberPresence } from './useMembers'

/** Mounted once in the shell: every live table is fed from this one subscriber. */
export function useShellLiveBus() {
  const { token, user } = useAuth()
  const userId = user?.uuid ?? null
  useLiveBus(Boolean(token), {
    ingest: {
      presence: [ingestAgentStatus, ingestMemberPresence],
      agents: [ingestAgentStatus],
      notifications: [(event: GatewayEvent) => ingestNotification(event, userId)],
    },
    onDisconnect: markAgentLiveRest,
  })
}
