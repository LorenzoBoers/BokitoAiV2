import { useCallback, useMemo, useRef, useState } from 'react'
import {
  getAgents,
  getTimeline,
  runWorkforceMaintenance,
  triggerAgent,
  updateAgentStatus,
  type WorkforceGraphEvent,
  type RuntimeActivity,
} from '../lib/workforce-api'
import {
  applyRealtimeEvent,
  buildViewState,
  type WorkforceViewState,
  type WorkforceNode,
} from '../lib/workforce-graph'

const EMPTY_STATE: WorkforceViewState = {
  workforceActive: false,
  pipelineStatus: 'runtime',
  nodes: [],
  rootIds: [],
  features: [],
  logs: [],
  updatedAt: 0,
}

function buildTriggerInstruction(node: WorkforceNode): string {
  if (node.roleSlug === 'productowner') {
    return [
      'Je bent Productowner. Haal nu de volledige Feature Queue op en pak exact 1 feature tegelijk op.',
      'Werk per feature sequentieel met deze flow:',
      '1) Analyseer de feature en formuleer een korte uitvoeropdracht voor Builder.',
      '2) Delegeer implementatie naar Builder en wacht op een duidelijke oplevering.',
      '3) Delegeer daarna testen naar Tester met concrete testcriteria en wacht op verdict.',
      '4) Delegeer daarna audit/review naar Auditor en wacht op verdict.',
      '5) Alleen bij groen resultaat ga je door naar de volgende feature.',
      '6) Bij fail of blockers stuur je de feature terug naar de juiste child-agent met gerichte herstelopdracht.',
      'Gebruik steeds de queue-volgorde en sla geen stappen over.',
    ].join(' ')
  }

  if (node.roleSlug === 'manager') {
    return 'Start direct met de aangevraagde uitvoering en bewaak dat Productowner features sequentieel afhandelt via builder, tester en auditor.'
  }

  return `Start direct met de aangevraagde uitvoering voor ${node.label}.`
}

const MAINTENANCE_MIN_INTERVAL_MS = 15 * 60 * 1000

export function useWorkforceData(token: string) {
  const [viewState, setViewState] = useState<WorkforceViewState>(EMPTY_STATE)
  const [timeline, setTimeline] = useState<RuntimeActivity[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isActioning, setIsActioning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [realtimeOrganisationId, setRealtimeOrganisationId] = useState<string | null>(null)
  const lastMaintenanceAtRef = useRef(0)

  const loadStatus = useCallback(async () => {
    setIsLoading(true)
    setError(null)
    try {
      const now = Date.now()
      if (now - lastMaintenanceAtRef.current >= MAINTENANCE_MIN_INTERVAL_MS) {
        lastMaintenanceAtRef.current = now
        await runWorkforceMaintenance(token).catch(() => null)
      }
      const [agents, nextTimeline] = await Promise.all([getAgents(token), getTimeline(token)])
      setViewState(buildViewState({ agents, timeline: nextTimeline }))
      setTimeline(nextTimeline)
      setRealtimeOrganisationId(agents[0]?.organisation_id ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kon status niet laden.')
    } finally {
      setIsLoading(false)
    }
  }, [token])

  const applyEvent = useCallback((event: WorkforceGraphEvent) => {
    setViewState((prev) => applyRealtimeEvent(prev, event))
  }, [])

  const setNodeStatus = useCallback(
    async (node: WorkforceNode, status: 'active' | 'standby', instructionOverride?: string) => {
      setIsActioning(true)
      setError(null)
      try {
        if (status === 'active') {
          const customInstruction = instructionOverride?.trim()
          await triggerAgent(token, {
            agent_id: node.id,
            instruction: customInstruction && customInstruction.length > 0 ? customInstruction : buildTriggerInstruction(node),
            priority: 'normal',
          })
        } else {
          await updateAgentStatus(token, node.id, 'standby')
        }
        await loadStatus()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Status wijzigen is mislukt.')
      } finally {
        setIsActioning(false)
      }
    },
    [loadStatus, token],
  )

  const nodesByRole = useMemo(() => {
    const byRole = new Map<string, WorkforceNode>()
    for (const node of viewState.nodes) {
      if (!byRole.has(node.roleSlug)) byRole.set(node.roleSlug, node)
    }
    return byRole
  }, [viewState.nodes])

  const labelByAgentId = useMemo(
    () => new Map(viewState.nodes.map((node) => [node.id, node.label])),
    [viewState.nodes],
  )
  const roleByAgentId = useMemo(
    () => new Map(viewState.nodes.map((node) => [node.id, node.roleSlug])),
    [viewState.nodes],
  )
  const managerNode = useMemo(
    () => viewState.nodes.find((node) => node.roleSlug === 'manager') ?? null,
    [viewState.nodes],
  )

  return {
    viewState,
    timeline,
    isLoading,
    isActioning,
    error,
    loadStatus,
    applyEvent,
    setNodeStatus,
    realtimeOrganisationId,
    nodesByRole,
    labelByAgentId,
    roleByAgentId,
    managerNode,
  }
}
