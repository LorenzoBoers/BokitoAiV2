export const appRoutes = {
  health: '/health',
  ready: '/health/ready',
  tools: '/tools',
  executeTool: '/tools/execute',
  ws: '/ws',
  openapiDocs: '/docs',
  mcp: '/mcp',
} as const

export const conversationsRoutes = {
  list: '/conversations',
  create: '/conversations',
  detail: (id: string) => `/conversations/${id}`,
  messages: (id: string) => `/conversations/${id}/messages`,
  reply: (id: string) => `/conversations/${id}/reply`,
  notes: (id: string) => `/conversations/${id}/notes`,
  status: (id: string) => `/conversations/${id}/status`,
  assign: (id: string) => `/conversations/${id}/assign`,
  tags: (id: string) => `/conversations/${id}/tags`,
  agent: (id: string) => `/conversations/${id}/agent`,
  usage: (id: string) => `/conversations/${id}/usage`,
} as const

export const decisionsRoutes = {
  list: '/decisions',
  detail: (id: string) => `/decisions/${id}`,
  resolve: (id: string) => `/decisions/${id}/resolve`,
} as const

export const contactsRoutes = {
  list: '/contacts',
  upsert: '/contacts',
  detail: (id: string) => `/contacts/${id}`,
  conversations: (id: string) => `/contacts/${id}/conversations`,
  organizations: '/organizations',
  organization: (id: string) => `/organizations/${id}`,
  organizationContacts: (id: string) => `/organizations/${id}/contacts`,
} as const

export const signalsRoutes = {
  types: '/signals/types',
  type: (id: string) => `/signals/types/${id}`,
  list: '/signals',
  detail: (id: string) => `/signals/${id}`,
} as const

export const workRoutes = {
  agents: '/agents',
  agent: (id: string) => `/agents/${id}`,
  playbooks: '/playbooks',
  playbook: (id: string) => `/playbooks/${id}`,
  runPlaybook: (id: string) => `/playbooks/${id}/run`,
  runs: '/runs',
  run: (id: string) => `/runs/${id}`,
  cancelRun: (id: string) => `/runs/${id}/cancel`,
  triggers: '/triggers',
  trigger: (id: string) => `/triggers/${id}`,
} as const

export const knowledgeRoutes = {
  docs: '/knowledge/docs',
  doc: (id: string) => `/knowledge/docs/${id}`,
  search: '/knowledge/search',
} as const

export const connectionsRoutes = {
  list: '/connections',
  create: '/connections',
  detail: (id: string) => `/connections/${id}`,
  verify: (id: string) => `/connections/${id}/verify`,
  providers: '/connections/catalog/providers',
} as const

export const governRoutes = {
  policy: '/govern/policy',
  posture: '/govern/policy/posture',
  allowances: '/govern/policy/allowances',
  disclosure: '/govern/policy/disclosure',
  changes: '/govern/changes',
  applyChange: (id: string) => `/govern/changes/${id}/apply`,
  rejectChange: (id: string) => `/govern/changes/${id}/reject`,
  rollbackChange: (id: string) => `/govern/changes/${id}/rollback`,
  audit: '/govern/audit',
  tokens: '/govern/tokens',
  token: (id: string) => `/govern/tokens/${id}`,
  usage: '/usage',
  outcomes: '/outcomes',
  computeOutcomes: '/outcomes/compute',
  feedback: '/feedback',
} as const

export const workspaceRoutes = {
  detail: '/workspace',
  members: '/workspace/members',
  member: (userId: string) => `/workspace/members/${userId}`,
  invites: '/workspace/invites',
  invite: (id: string) => `/workspace/invites/${id}`,
} as const
