/**
 * TanStack Query hooks per aggregate. Keys are flat arrays so realtime events
 * can invalidate by prefix (`['conversations']`, `['thread', id]`, ...).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  appRoutes,
  connectionsRoutes,
  contactsRoutes,
  conversationsRoutes,
  decisionsRoutes,
  governRoutes,
  knowledgeRoutes,
  modulesRoutes,
  signalsRoutes,
  workRoutes,
  workspaceRoutes,
} from '@/api/routes'
import type * as T from '@/api/types'
import { api, request } from '@/lib/api'

type Query = Record<string, string | number | boolean | undefined>

export const keys = {
  conversations: (q?: Query) => ['conversations', q ?? {}] as const,
  conversation: (id: string) => ['conversation', id] as const,
  thread: (id: string) => ['thread', id] as const,
  conversationUsage: (id: string) => ['conversation-usage', id] as const,
  decisions: ['decisions'] as const,
  contacts: (q?: string) => ['contacts', q ?? ''] as const,
  contact: (id: string) => ['contact', id] as const,
  contactConversations: (id: string) => ['contact-conversations', id] as const,
  organizations: ['organizations'] as const,
  signalTypes: ['signal-types'] as const,
  agents: ['agents'] as const,
  agent: (id: string) => ['agent', id] as const,
  playbooks: ['playbooks'] as const,
  runs: (q?: Query) => ['runs', q ?? {}] as const,
  run: (id: string) => ['run', id] as const,
  triggers: ['triggers'] as const,
  docs: (kind?: string) => ['docs', kind ?? ''] as const,
  doc: (id: string) => ['doc', id] as const,
  knowledgeSearch: (q: string) => ['knowledge-search', q] as const,
  connections: ['connections'] as const,
  providers: ['providers'] as const,
  modules: ['modules'] as const,
  policy: ['policy'] as const,
  changes: ['changes'] as const,
  audit: (q?: Query) => ['audit', q ?? {}] as const,
  tokens: ['tokens'] as const,
  usage: ['usage'] as const,
  outcomes: ['outcomes'] as const,
  tools: ['tools'] as const,
  workspace: ['workspace'] as const,
  members: ['members'] as const,
  invites: ['invites'] as const,
  feedback: ['feedback'] as const,
}

// Conversations ---------------------------------------------------------------

export function useConversations(q: Query) {
  return useQuery({
    queryKey: keys.conversations(q),
    queryFn: () => api.get<T.ConversationList>(conversationsRoutes.list, q),
    placeholderData: (prev) => prev,
  })
}

export function useConversation(id: string | undefined) {
  return useQuery({
    queryKey: keys.conversation(id ?? ''),
    queryFn: () => api.get<T.Conversation>(conversationsRoutes.detail(id!)),
    enabled: Boolean(id),
  })
}

export function useThread(id: string | undefined) {
  return useQuery({
    queryKey: keys.thread(id ?? ''),
    queryFn: () => api.get<T.Thread>(conversationsRoutes.messages(id!)),
    enabled: Boolean(id),
  })
}

export function useConversationUsage(id: string | undefined) {
  return useQuery({
    queryKey: keys.conversationUsage(id ?? ''),
    queryFn: () => api.get<T.ConversationUsage>(conversationsRoutes.usage(id!)),
    enabled: Boolean(id),
  })
}

function useInvalidate(...prefixes: readonly (readonly unknown[])[]) {
  const qc = useQueryClient()
  return () => Promise.all(prefixes.map((p) => qc.invalidateQueries({ queryKey: p as unknown[] })))
}

export function useConversationActions(id: string) {
  const invalidate = useInvalidate(['conversation', id], ['thread', id], ['conversations'], ['decisions'])
  const reply = useMutation({
    mutationFn: (body: { body: string; draft?: boolean }) =>
      api.post<T.ToolOutcome>(conversationsRoutes.reply(id), body),
    onSuccess: invalidate,
  })
  const note = useMutation({
    mutationFn: (body: string) => api.post<T.ToolOutcome>(conversationsRoutes.notes(id), { body }),
    onSuccess: invalidate,
  })
  const setStatus = useMutation({
    mutationFn: (body: { status: T.ConversationStatus; follow_up_at?: string | null }) =>
      api.post<T.Conversation>(conversationsRoutes.status(id), body),
    onSuccess: invalidate,
  })
  const assign = useMutation({
    mutationFn: (body: { user_id?: string | null; agent_id?: string | null }) =>
      api.post<T.Conversation>(conversationsRoutes.assign(id), body),
    onSuccess: invalidate,
  })
  const setTags = useMutation({
    mutationFn: (tags: string[]) => api.put<T.Conversation>(conversationsRoutes.tags(id), { tags }),
    onSuccess: invalidate,
  })
  const askAgent = useMutation({
    mutationFn: (agentId?: string) =>
      request<{ queued: boolean }>(conversationsRoutes.agent(id), {
        method: 'POST',
        query: { agent_id: agentId },
      }),
    onSuccess: invalidate,
  })
  return { reply, note, setStatus, assign, setTags, askAgent }
}

export function useCreateConversation() {
  const invalidate = useInvalidate(['conversations'])
  return useMutation({
    mutationFn: (body: { subject: string; body: string; ask_agent?: boolean; tags?: string[]; contact_id?: string }) =>
      api.post<T.Conversation>(conversationsRoutes.create, body),
    onSuccess: invalidate,
  })
}

// Decisions -------------------------------------------------------------------

export function useDecisions() {
  return useQuery({ queryKey: keys.decisions, queryFn: () => api.get<T.Decision[]>(decisionsRoutes.list) })
}

export function useResolveDecision() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, option, note }: { id: string; option: string; note?: string }) =>
      api.post<T.Decision>(decisionsRoutes.resolve(id), { option, note: note ?? '' }),
    onSuccess: (d) => {
      void qc.invalidateQueries({ queryKey: ['decisions'] })
      void qc.invalidateQueries({ queryKey: ['thread', d.conversation_id] })
      void qc.invalidateQueries({ queryKey: ['conversations'] })
      void qc.invalidateQueries({ queryKey: ['changes'] })
      void qc.invalidateQueries({ queryKey: ['policy'] })
    },
  })
}

// Contacts --------------------------------------------------------------------

export function useContacts(q?: string) {
  return useQuery({
    queryKey: keys.contacts(q),
    queryFn: () => api.get<T.Contact[]>(contactsRoutes.list, { q }),
  })
}

export function useContact(id: string | null | undefined) {
  return useQuery({
    queryKey: keys.contact(id ?? ''),
    queryFn: () => api.get<T.Contact>(contactsRoutes.detail(id!)),
    enabled: Boolean(id),
  })
}

export function useContactConversations(id: string | null | undefined) {
  return useQuery({
    queryKey: keys.contactConversations(id ?? ''),
    queryFn: () => api.get<T.Conversation[]>(contactsRoutes.conversations(id!)),
    enabled: Boolean(id),
  })
}

export function useUpsertContact() {
  const invalidate = useInvalidate(['contacts'], ['contact'])
  return useMutation({
    mutationFn: (body: Partial<T.Contact> & { contact_id?: string }) =>
      api.post<T.ToolOutcome>(contactsRoutes.upsert, body),
    onSuccess: invalidate,
  })
}

export function useOrganizations() {
  return useQuery({
    queryKey: keys.organizations,
    queryFn: () => api.get<T.Organization[]>(contactsRoutes.organizations),
  })
}

export function useSignalTypes() {
  return useQuery({ queryKey: keys.signalTypes, queryFn: () => api.get<T.SignalType[]>(signalsRoutes.types) })
}

// Work ------------------------------------------------------------------------

export function useAgents() {
  return useQuery({ queryKey: keys.agents, queryFn: () => api.get<T.Agent[]>(workRoutes.agents) })
}

export function useAgent(id: string | undefined) {
  return useQuery({
    queryKey: keys.agent(id ?? ''),
    queryFn: () => api.get<T.Agent>(workRoutes.agent(id!)),
    enabled: Boolean(id),
  })
}

export function useAgentMutations() {
  const invalidate = useInvalidate(['agents'], ['agent'], ['changes'])
  const create = useMutation({
    mutationFn: (body: Partial<T.Agent> & { name: string }) => api.post<T.ToolOutcome>(workRoutes.agents, body),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<T.Agent> }) =>
      api.patch<T.Agent>(workRoutes.agent(id), { patch }),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.delete<void>(workRoutes.agent(id)),
    onSuccess: invalidate,
  })
  return { create, update, remove }
}

export function usePlaybooks() {
  return useQuery({ queryKey: keys.playbooks, queryFn: () => api.get<T.Playbook[]>(workRoutes.playbooks) })
}

export function usePlaybookMutations() {
  const invalidate = useInvalidate(['playbooks'], ['runs'], ['changes'])
  const create = useMutation({
    mutationFn: (body: { name: string; description?: string; steps: T.PlaybookStep[]; agent_id?: string | null }) =>
      api.post<T.ToolOutcome>(workRoutes.playbooks, body),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: ({ id, ...patch }: { id: string } & Partial<T.Playbook>) =>
      api.patch<T.Playbook>(workRoutes.playbook(id), patch),
    onSuccess: invalidate,
  })
  const run = useMutation({
    mutationFn: (id: string) => api.post<T.ToolOutcome>(workRoutes.runPlaybook(id)),
    onSuccess: invalidate,
  })
  return { create, update, run }
}

export function useRuns(q: Query = {}) {
  return useQuery({
    queryKey: keys.runs(q),
    queryFn: () => api.get<T.Run[]>(workRoutes.runs, q),
    refetchInterval: 5000,
  })
}

export function useRun(id: string | undefined) {
  return useQuery({
    queryKey: keys.run(id ?? ''),
    queryFn: () => api.get<T.RunDetail>(workRoutes.run(id!)),
    enabled: Boolean(id),
    refetchInterval: (q) =>
      q.state.data && ['queued', 'running'].includes(q.state.data.status) ? 2000 : false,
  })
}

export function useTriggers() {
  return useQuery({ queryKey: keys.triggers, queryFn: () => api.get<T.Trigger[]>(workRoutes.triggers) })
}

export function useTriggerMutations() {
  const invalidate = useInvalidate(['triggers'])
  const create = useMutation({
    mutationFn: (body: {
      name: string
      kind: T.Trigger['kind']
      spec?: Record<string, unknown>
      instructions?: string
      agent_id?: string | null
      playbook_id?: string | null
    }) => api.post<T.ToolOutcome>(workRoutes.triggers, body),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: ({ id, ...patch }: { id: string } & Partial<T.Trigger>) =>
      api.patch<T.Trigger>(workRoutes.trigger(id), patch),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.delete<void>(workRoutes.trigger(id)),
    onSuccess: invalidate,
  })
  return { create, update, remove }
}

// Knowledge -------------------------------------------------------------------

export function useDocs(kind?: string) {
  return useQuery({
    queryKey: keys.docs(kind),
    queryFn: () => api.get<T.DocSummary[]>(knowledgeRoutes.docs, { kind }),
  })
}

export function useDoc(id: string | undefined) {
  return useQuery({
    queryKey: keys.doc(id ?? ''),
    queryFn: () => api.get<T.Doc>(knowledgeRoutes.doc(id!)),
    enabled: Boolean(id),
  })
}

export function useKnowledgeSearch(q: string) {
  return useQuery({
    queryKey: keys.knowledgeSearch(q),
    queryFn: () => api.get<T.KnowledgeHit[]>(knowledgeRoutes.search, { q }),
    enabled: q.trim().length > 1,
  })
}

export function useDocMutations() {
  const invalidate = useInvalidate(['docs'], ['doc'])
  const write = useMutation({
    mutationFn: (body: { title: string; body: string; kind?: T.DocKind; path?: string; published?: boolean }) =>
      api.post<T.ToolOutcome>(knowledgeRoutes.docs, body),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.delete<void>(knowledgeRoutes.doc(id)),
    onSuccess: invalidate,
  })
  return { write, remove }
}

// Connections -----------------------------------------------------------------

export function useConnections() {
  return useQuery({
    queryKey: keys.connections,
    queryFn: () => api.get<T.Connection[]>(connectionsRoutes.list),
  })
}

export function useProviders() {
  return useQuery({
    queryKey: keys.providers,
    queryFn: () => api.get<Record<string, T.Provider[]>>(connectionsRoutes.providers),
    staleTime: Infinity,
  })
}

export function useConnectionMutations() {
  const invalidate = useInvalidate(['connections'])
  const create = useMutation({
    mutationFn: (body: {
      kind: T.ConnectionKind
      provider: string
      name: string
      address?: string
      credentials?: Record<string, string>
      settings?: Record<string, unknown>
      disclosure_enabled?: boolean
      region?: string
      agent_id?: string | null
    }) => api.post<T.Connection>(connectionsRoutes.create, body),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: ({ id, ...patch }: { id: string } & Record<string, unknown>) =>
      api.patch<T.Connection>(connectionsRoutes.detail(id), patch),
    onSuccess: invalidate,
  })
  const verify = useMutation({
    mutationFn: (id: string) => api.post<T.Connection>(connectionsRoutes.verify(id)),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: string) => api.delete<void>(connectionsRoutes.detail(id)),
    onSuccess: invalidate,
  })
  return { create, update, verify, remove }
}

// Modules ---------------------------------------------------------------------

export function useModules() {
  return useQuery({
    queryKey: keys.modules,
    queryFn: () => api.get<T.Module[]>(modulesRoutes.list),
  })
}

export function useModuleMutations() {
  const invalidate = useInvalidate(['modules'], ['signal-types'], ['playbooks'], ['docs'], ['tools'])
  const install = useMutation({
    mutationFn: ({ slug, ...body }: { slug: string; connection_id?: string | null; settings?: Record<string, unknown> }) =>
      api.post<T.Module>(modulesRoutes.install(slug), body),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: ({ slug, ...body }: { slug: string; connection_id?: string | null; settings?: Record<string, unknown> }) =>
      api.patch<T.Module>(modulesRoutes.detail(slug), body),
    onSuccess: invalidate,
  })
  const uninstall = useMutation({
    mutationFn: (slug: string) => api.delete<void>(modulesRoutes.detail(slug)),
    onSuccess: invalidate,
  })
  return { install, update, uninstall }
}

// Govern ----------------------------------------------------------------------

export function usePolicy() {
  return useQuery({ queryKey: keys.policy, queryFn: () => api.get<T.Policy>(governRoutes.policy) })
}

export function usePolicyMutations() {
  const invalidate = useInvalidate(['policy'], ['changes'], ['decisions'], ['me'])
  const setPosture = useMutation({
    mutationFn: (posture: T.Posture) => api.post<T.ToolOutcome>(governRoutes.posture, { posture }),
    onSuccess: invalidate,
  })
  const setAllowance = useMutation({
    mutationFn: (body: { category?: T.ToolCategory; tool_name?: string; verdict: T.Verdict | null }) =>
      api.post<T.Policy>(governRoutes.allowances, body),
    onSuccess: invalidate,
  })
  const setDisclosure = useMutation({
    mutationFn: (disclosure_text: string) => api.put<T.Policy>(governRoutes.disclosure, { disclosure_text }),
    onSuccess: invalidate,
  })
  return { setPosture, setAllowance, setDisclosure }
}

export function useChanges() {
  return useQuery({ queryKey: keys.changes, queryFn: () => api.get<T.Change[]>(governRoutes.changes) })
}

export function useChangeMutations() {
  const invalidate = useInvalidate(['changes'], ['policy'], ['agents'], ['playbooks'])
  const apply = useMutation({
    mutationFn: (id: string) => api.post<T.Change>(governRoutes.applyChange(id)),
    onSuccess: invalidate,
  })
  const reject = useMutation({
    mutationFn: (id: string) => api.post<T.Change>(governRoutes.rejectChange(id)),
    onSuccess: invalidate,
  })
  const rollback = useMutation({
    mutationFn: (id: string) => api.post<T.Change>(governRoutes.rollbackChange(id)),
    onSuccess: invalidate,
  })
  return { apply, reject, rollback }
}

export function useAudit(q: Query = {}) {
  return useQuery({
    queryKey: keys.audit(q),
    queryFn: () => api.get<T.AuditEvent[]>(governRoutes.audit, q),
  })
}

export function useTokens() {
  return useQuery({ queryKey: keys.tokens, queryFn: () => api.get<T.ApiToken[]>(governRoutes.tokens) })
}

export function useTokenMutations() {
  const invalidate = useInvalidate(['tokens'])
  const create = useMutation({
    mutationFn: (body: { name: string; scopes: string[] }) => api.post<T.ApiToken>(governRoutes.tokens, body),
    onSuccess: invalidate,
  })
  const revoke = useMutation({
    mutationFn: (id: string) => api.delete<void>(governRoutes.token(id)),
    onSuccess: invalidate,
  })
  return { create, revoke }
}

export function useUsage() {
  return useQuery({ queryKey: keys.usage, queryFn: () => api.get<T.UsageReport>(governRoutes.usage) })
}

export function useOutcomes() {
  return useQuery({ queryKey: keys.outcomes, queryFn: () => api.get<T.OutcomeSummary>(governRoutes.outcomes) })
}

export function useFeedbackMutation() {
  const invalidate = useInvalidate(['feedback'])
  return useMutation({
    mutationFn: (body: {
      conversation_id?: string
      message_id?: string
      run_id?: string
      verdict: T.Feedback['verdict']
      comment?: string
      correction?: string
      learn?: boolean
    }) => api.post<T.Feedback>(governRoutes.feedback, body),
    onSuccess: invalidate,
  })
}

// Tools -----------------------------------------------------------------------

export function useTools() {
  return useQuery({ queryKey: keys.tools, queryFn: () => api.get<T.ToolDef[]>(appRoutes.tools), staleTime: 300_000 })
}

export function useExecuteTool() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { name: string; args: Record<string, unknown>; conversation_id?: string }) =>
      api.post<T.ToolOutcome>(appRoutes.executeTool, body),
    onSuccess: () => void qc.invalidateQueries(),
  })
}

// Workspace -------------------------------------------------------------------

export function useWorkspace() {
  return useQuery({ queryKey: keys.workspace, queryFn: () => api.get<T.Workspace>(workspaceRoutes.detail) })
}

export function useMembers() {
  return useQuery({ queryKey: keys.members, queryFn: () => api.get<T.Member[]>(workspaceRoutes.members) })
}

export function useInvites() {
  return useQuery({ queryKey: keys.invites, queryFn: () => api.get<T.Invite[]>(workspaceRoutes.invites) })
}

export function useWorkspaceMutations() {
  const invalidate = useInvalidate(['workspace'], ['members'], ['invites'], ['me'])
  const update = useMutation({
    mutationFn: (body: { name?: string; language?: string; settings?: Record<string, unknown> }) =>
      api.patch<T.Workspace>(workspaceRoutes.detail, body),
    onSuccess: invalidate,
  })
  const invite = useMutation({
    mutationFn: (body: { email: string; role: string }) => api.post<T.Invite>(workspaceRoutes.invites, body),
    onSuccess: invalidate,
  })
  const withdrawInvite = useMutation({
    mutationFn: (id: string) => api.delete<void>(workspaceRoutes.invite(id)),
    onSuccess: invalidate,
  })
  const setRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      api.patch<T.Member>(workspaceRoutes.member(userId), { role }),
    onSuccess: invalidate,
  })
  const removeMember = useMutation({
    mutationFn: (userId: string) => api.delete<void>(workspaceRoutes.member(userId)),
    onSuccess: invalidate,
  })
  return { update, invite, withdrawInvite, setRole, removeMember }
}
