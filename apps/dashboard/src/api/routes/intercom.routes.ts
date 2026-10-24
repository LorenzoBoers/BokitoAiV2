/** Relative paths for the dock intercom (`APP_API_BASE`). */
export const intercomRoutes = {
  talk: (agentId: string) => `/intercom/${encodeURIComponent(agentId)}`,
  talkAll: '/intercom/all',
  queue: (returning = false) => (returning ? '/intercom/queue?returning=true' : '/intercom/queue'),
  audio: (noteId: string) => `/intercom/notes/${encodeURIComponent(noteId)}/audio`,
  played: (noteId: string) => `/intercom/notes/${encodeURIComponent(noteId)}/played`,
  last: (agentId?: string | null) =>
    agentId ? `/intercom/last?agent_id=${encodeURIComponent(agentId)}` : '/intercom/last',
  lane: (agentId: string) => `/intercom/lane/${encodeURIComponent(agentId)}`,
  route: (messageId: string) => `/intercom/route/${encodeURIComponent(messageId)}`,
  dockAgents: '/me/dock-agents',
}
