import type {
  RuntimeActivity,
  RuntimeAgent,
  WorkforceGraphEvent,
} from './workforce-api'

export type AgentNodeStatus = 'active' | 'awaiting' | 'activating' | 'standby' | 'disabled' | 'error'

export interface WorkforceNode {
  id: string
  label: string
  roleSlug: string
  roleName: string
  status: AgentNodeStatus
  currentActivity: string | null
  parentId: string | null
}

export interface WorkforceViewState {
  workforceActive: boolean
  pipelineStatus: string
  nodes: WorkforceNode[]
  rootIds: string[]
  features: FeatureSummary[]
  logs: SessionEntry[]
  updatedAt: number
}

export interface FeatureSummary {
  id: string
  name: string
  status: string
  assignedTo: 'builder' | 'tester' | 'auditor' | null
}

export interface SessionEntry {
  id: string
  level: string
  actionType: string
  message: string
  createdAt: number
  featureId: string
  pipelineId: number
}

interface RuntimeSnapshot {
  agents: RuntimeAgent[]
  timeline: RuntimeActivity[]
}

const STALE_EXECUTING_MS = 4 * 60 * 60 * 1000
const PRD_REMAINING_POINTS = [
  'Conversational agent op mobile, Chrome extensie, widget en portal',
  'Natuurlijke taalvragen over bedrijfsdata en processen',
  'Tool- en API-acties vanuit de conversational agent',
  'Documentverwerking met OCR/herkenning en routering',
  'Screen context awareness met actievoorstellen',
  'Cloud agents met scheduled, event-based en manual triggers',
  'Auto-execution mode voor cloud agents',
  'Proposal mode met approve/reject flow',
  'Centraal proposal dashboard met statusoverzicht',
  'Configureerbare workflows per agent zonder code',
  'Multi-agent architectuur met duidelijke rolscheiding',
  'Audit logging van acties en beslissingen',
]

type QueueStage = 'te_implementeren' | 'te_testen' | 'te_auditen'
const QUEUE_STAGES: readonly QueueStage[] = ['te_implementeren', 'te_testen', 'te_auditen']

function activityTs(activity: RuntimeActivity): number {
  return Number(activity.updated_at ?? activity.created_at ?? 0)
}

function sortTimelineDesc(timeline: RuntimeActivity[]): RuntimeActivity[] {
  return [...timeline].sort((a, b) => activityTs(b) - activityTs(a))
}

function activityEnded(activity: RuntimeActivity): boolean {
  return Boolean(
    activity.actual_end ??
      activity.ended_at ??
      activity.session_ended_at,
  )
}

function hasLiveSession(agent: RuntimeAgent, timeline: RuntimeActivity[], nowTs: number): boolean {
  // A session is "live" only while there is an executing activity with a real runtime session check-in.
  return timeline.some((activity) => {
    if (activity.agent_id !== agent.id) return false
    if (activity.type !== 'executing') return false
    if (activityEnded(activity)) return false
    const hasSessionRef = Boolean(activity.session_id ?? agent.current_session_id)
    if (!hasSessionRef) return false
    const updatedAt = activityTs(activity)
    if (!updatedAt) return false
    return nowTs - updatedAt <= STALE_EXECUTING_MS
  })
}

function deriveNodes(agents: RuntimeAgent[], timeline: RuntimeActivity[]): WorkforceNode[] {
  const nowTs = Date.now()
  const agentById = new Map(agents.map((agent) => [agent.id, agent]))
  const childIdsByParent = new Map<string, string[]>()
  for (const agent of agents) {
    if (!agent.parent_agent_id) continue
    const list = childIdsByParent.get(agent.parent_agent_id) ?? []
    list.push(agent.id)
    childIdsByParent.set(agent.parent_agent_id, list)
  }

  const liveByAgentId = new Map(agents.map((agent) => [agent.id, hasLiveSession(agent, timeline, nowTs)]))
  const baseStatusByAgentId = new Map<string, AgentNodeStatus>()

  for (const agent of agents) {
    let status: AgentNodeStatus
    if (agent.status === 'error') {
      status = 'error'
    } else if (agent.status === 'standby') {
      status = 'standby'
    } else if (liveByAgentId.get(agent.id)) {
      status = 'active'
    } else if (agent.status === 'active') {
      status = 'activating'
    } else {
      status = 'disabled'
    }
    baseStatusByAgentId.set(agent.id, status)
  }

  return agents.map((agent) => {
    const latest = timeline.find((a) => a.agent_id === agent.id && (a.type === 'executing' || a.type === 'planned'))
    const waitingForCheckIn = Boolean(
      agent.status === 'active' &&
        latest &&
        latest.type === 'executing' &&
        !activityEnded(latest) &&
        !latest.session_id &&
        !agent.current_session_id,
    )
    const baseStatus = baseStatusByAgentId.get(agent.id) ?? 'disabled'
    const childIds = childIdsByParent.get(agent.id) ?? []
    const awaitingChild = childIds
      .map((id) => agentById.get(id))
      .find((child) => {
        if (!child) return false
        const childStatus = baseStatusByAgentId.get(child.id)
        return childStatus === 'active' || childStatus === 'activating'
      })

    const status: AgentNodeStatus =
      (baseStatus === 'disabled' || baseStatus === 'standby') && awaitingChild ? 'awaiting' : baseStatus

    const awaitingText = awaitingChild ? `Wacht op ${awaitingChild.name}` : null
    const showRuntimeSummary = status === 'active' || status === 'activating' || status === 'awaiting'
    const activationText = waitingForCheckIn ? 'Initializing' : null
    const currentActivity = showRuntimeSummary
      ? activationText ?? agent.current_activity_summary ?? awaitingText ?? latest?.title ?? null
      : status === 'standby'
        ? 'Standby'
        : null

    return {
      id: agent.id,
      label: agent.name,
      roleSlug: agent.role_slug ?? 'unknown',
      roleName: agent.role_name ?? 'Unknown',
      parentId: agent.parent_agent_id,
      currentActivity,
      status,
    }
  })
}

function deriveRootIds(nodes: WorkforceNode[]): string[] {
  const ids = new Set(nodes.map((n) => n.id))
  return nodes.filter((n) => !n.parentId || !ids.has(n.parentId)).map((n) => n.id)
}

function mapLogs(timeline: RuntimeActivity[], nodes: WorkforceNode[]): SessionEntry[] {
  const labelByAgentId = new Map(nodes.map((node) => [node.id, node.label]))
  return timeline.slice(0, 120).map((activity) => ({
    id: activity.id,
    level: activity.type === 'failed' ? 'error' : 'info',
    actionType: `${labelByAgentId.get(activity.agent_id) ?? 'Agent'}: ${activity.title}`,
    message: activity.status_detail ?? activity.description ?? activity.title,
    createdAt: activity.updated_at ?? activity.created_at,
    featureId: activity.id,
    pipelineId: 0,
  }))
}

function stageAssignee(stage: QueueStage): FeatureSummary['assignedTo'] {
  if (stage === 'te_implementeren') return 'builder'
  if (stage === 'te_testen') return 'tester'
  if (stage === 'te_auditen') return 'auditor'
  return null
}

function extractFeatures(_timeline: RuntimeActivity[], _nodes: WorkforceNode[]): FeatureSummary[] {
  // Product request: clear current runtime queue and show remaining PRD points as actionable queue items.
  return PRD_REMAINING_POINTS.flatMap((point, index) =>
    QUEUE_STAGES.map((stage, stageIndex) => ({
      id: `prd-${index + 1}-${stageIndex + 1}`,
      name: point,
      status: stage,
      assignedTo: stageAssignee(stage),
    })),
  )
}

function managerActive(nodes: WorkforceNode[]): boolean {
  const manager = nodes.find((node) => node.roleSlug === 'manager')
  if (!manager) return false
  return manager.status === 'active' || manager.status === 'activating' || manager.status === 'awaiting'
}

export function buildViewState(snapshot: RuntimeSnapshot): WorkforceViewState {
  const timeline = sortTimelineDesc(snapshot.timeline)
  const nodes = deriveNodes(snapshot.agents, timeline)
  return {
    workforceActive: managerActive(nodes),
    pipelineStatus: 'runtime',
    nodes,
    rootIds: deriveRootIds(nodes),
    features: extractFeatures(timeline, nodes),
    logs: mapLogs(timeline, nodes),
    updatedAt: Date.now(),
  }
}

export function applyRealtimeEvent(
  state: WorkforceViewState,
  event: WorkforceGraphEvent,
): WorkforceViewState {
  const ts = event.ts || Date.now()
  if (event.event_type === 'activity_updated' || event.event_type === 'task_updated' || event.event_type === 'message_created' || event.event_type === 'agent_updated') {
    const nextEntry: SessionEntry = {
      id: `${event.event_type}-${ts}`,
      level: 'info',
      actionType: event.event_type,
      message: JSON.stringify(event.payload ?? {}),
      createdAt: ts,
      featureId: String(event.activity_id ?? ''),
      pipelineId: 0,
    }
    return { ...state, logs: [nextEntry, ...state.logs].slice(0, 120), updatedAt: ts }
  }
  return { ...state, updatedAt: ts }
}
