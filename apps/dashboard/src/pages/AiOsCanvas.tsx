import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  BookOpen,
  Bot,
  ExternalLink,
  FolderGit2,
  GitBranch,
  LayoutGrid,
  Maximize2,
  Plug,
  Plus,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageContent } from '../components/layout/PageContent'
import { LoadingBlock } from '../components/ui/loading-block'
import { ApiErrorBanner } from '../components/ui/ApiErrorBanner'
import { Button } from '../components/ui/button'
import OsFlowNode, { type OsFlowNodeData } from '../components/aios/OsFlowNode'
import NodeDetailPanel, { type NodeDetailPanelProps } from '../components/aios/NodeDetailPanel'
import OsAddNodePalette, { OsAddNodeTrigger } from '../components/aios/OsAddNodePalette'
import DecisionsInline from '../components/aios/DecisionsInline'
import { listGovernChanges, type PlatformChangeRow } from '../lib/govern-api'
import { useOsGraph } from '../hooks/useOsGraph'
import { useAuth } from '../context/AuthContext'
import {
  createCanvasEdge,
  deleteCanvasEdge,
  deleteCanvasNode,
  patchCanvasNode,
  resolveEdgeRelation,
  type OsCanvasNode,
  type OsEdgeRelation,
} from '../lib/os-api'
import { cn } from '../lib/utils'

const nodeTypes: NodeTypes = {
  osNode: OsFlowNode,
}

const RELATION_LABELS: Record<OsEdgeRelation, string> = {
  routed_by: 'Routed by',
  uses_repo: 'Uses repo',
  uses_tool: 'Uses tool',
  reads_blueprint: 'Reads blueprint',
}

const PIPELINE_LANES = [
  { id: 'sensing', label: 'Sensing' },
  { id: 'interpretation', label: 'Interpretation' },
  { id: 'orchestration', label: 'Orchestration' },
  { id: 'integration', label: 'Integration' },
  { id: 'learning', label: 'Learning' },
  { id: 'govern', label: 'Govern' },
] as const

/** Comfortable margin around nodes for fit-view (fraction of viewport). */
const CANVAS_FIT_VIEW_PADDING = 0.32
const CANVAS_FIT_VIEW_OPTIONS = { padding: CANVAS_FIT_VIEW_PADDING, duration: 280 } as const

function nodeLane(nodeType: OsCanvasNode['node_type']): string {
  if (nodeType === 'orchestrator' || nodeType === 'workstream') return 'orchestration'
  if (nodeType === 'tool' || nodeType === 'repo') return 'integration'
  if (nodeType === 'blueprint') return 'interpretation'
  return 'orchestration'
}

function FitViewOnLoad({ nodeCount }: { nodeCount: number }) {
  const { fitView } = useReactFlow()
  useEffect(() => {
    if (nodeCount <= 0) return
    const timer = window.setTimeout(() => {
      void fitView(CANVAS_FIT_VIEW_OPTIONS)
    }, 80)
    return () => window.clearTimeout(timer)
  }, [nodeCount, fitView])
  return null
}

const LANE_COLUMNS: Record<string, number> = {
  interpretation: 0,
  orchestration: 1,
  integration: 2,
}

export default function AiOsCanvas() {
  return (
    <ReactFlowProvider>
      <AiOsCanvasInner />
    </ReactFlowProvider>
  )
}

function AiOsCanvasInner() {
  const { t } = useTranslation('aios')
  const { token } = useAuth()
  const { fitView } = useReactFlow()
  const { graph, loading, error, degraded, refresh } = useOsGraph()
  const [pendingChanges, setPendingChanges] = useState<PlatformChangeRow[]>([])
  const [selected, setSelected] = useState<OsCanvasNode | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [activeLane, setActiveLane] = useState<string | null>(null)

  useEffect(() => {
    listGovernChanges('pending_review')
      .then((resp) => setPendingChanges(resp.items))
      .catch(() => setPendingChanges([]))
  }, [graph])

  const onSelectNode = useCallback((node: OsCanvasNode) => {
    setSelected(node)
  }, [])

  const pendingRefIds = useMemo(() => {
    const ids = new Set<string>()
    for (const change of pendingChanges) {
      if (change.resource_id) ids.add(change.resource_id)
      const afterRef = change.after?.agent_id ?? change.after?.workstream_id ?? change.after?.ref_id
      if (typeof afterRef === 'string') ids.add(afterRef)
    }
    return ids
  }, [pendingChanges])

  const flowNodes: Node[] = useMemo(() => {
    if (!graph) return []
    return graph.nodes.map((node) => ({
      id: node.id,
      type: 'osNode',
      position: { x: node.x, y: node.y },
      data: {
        node,
        selected: selected?.id === node.id,
        onSelect: onSelectNode,
        pendingDraft: pendingRefIds.has(node.ref_id),
        dimmed: Boolean(activeLane && nodeLane(node.node_type) !== activeLane),
      } satisfies OsFlowNodeData,
      draggable: true,
    }))
  }, [graph, selected?.id, onSelectNode, pendingRefIds, activeLane])

  const flowEdges: Edge[] = useMemo(() => {
    if (!graph) return []
    return graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source_node_id,
      target: edge.target_node_id,
      label: RELATION_LABELS[edge.relation] ?? edge.relation,
      type: 'smoothstep',
      animated: edge.relation === 'routed_by',
      style: { stroke: 'rgba(99, 102, 241, 0.45)', strokeWidth: 1.5 },
    }))
  }, [graph])

  const onNodeDragStop = useCallback(
    async (_: unknown, node: Node) => {
      if (!token || degraded || node.id.startsWith('fallback-')) return
      await patchCanvasNode(node.id, { x: node.position.x, y: node.position.y }, token)
      void refresh()
    },
    [token, degraded, refresh],
  )

  const onConnect = useCallback(
    async (connection: Connection) => {
      if (!token || !graph || degraded || !connection.source || !connection.target) return
      if (connection.source.startsWith('fallback-') || connection.target.startsWith('fallback-')) return
      const sourceNode = graph.nodes.find((n) => n.id === connection.source)
      const targetNode = graph.nodes.find((n) => n.id === connection.target)
      if (!sourceNode || !targetNode) return
      const resolved = resolveEdgeRelation(
        sourceNode.node_type,
        targetNode.node_type,
        sourceNode.id,
        targetNode.id,
      )
      if (!resolved) return
      try {
        await createCanvasEdge(resolved, token)
        toast.success(t('actions.connectionCreated', { defaultValue: 'Connection created' }))
        void refresh()
      } catch {
        toast.error(t('actions.connectionFailed', { defaultValue: 'Could not create that connection' }))
      }
    },
    [token, graph, degraded, refresh, t],
  )

  const handleFitView = useCallback(() => {
    void fitView(CANVAS_FIT_VIEW_OPTIONS)
  }, [fitView])

  const handleOrganizeLayout = useCallback(async () => {
    if (!graph || !token || degraded) return
    const buckets: Record<string, OsCanvasNode[]> = {}
    for (const node of graph.nodes) {
      const lane = nodeLane(node.node_type)
      if (!buckets[lane]) buckets[lane] = []
      buckets[lane].push(node)
    }
    const colWidth = 260
    const rowHeight = 132
    const startX = 48
    const startY = 48
    const updates: Promise<unknown>[] = []
    for (const [lane, colIndex] of Object.entries(LANE_COLUMNS)) {
      const nodes = buckets[lane] ?? []
      nodes.forEach((node, idx) => {
        updates.push(
          patchCanvasNode(
            node.id,
            { x: startX + colIndex * colWidth, y: startY + idx * rowHeight },
            token,
          ),
        )
      })
    }
    await Promise.all(updates)
    toast.success(t('actions.layoutOrganized', { defaultValue: 'Canvas layout organized' }))
    void refresh()
    window.setTimeout(() => void fitView(CANVAS_FIT_VIEW_OPTIONS), 120)
  }, [graph, token, degraded, refresh, fitView, t])

  const panel = useMemo<NodeDetailPanelProps | null>(() => {
    if (!selected || !graph) return null
    const close = () => setSelected(null)
    const base = { open: true, onClose: close }

    const connectedEdges = graph.edges.filter(
      (e) => e.source_node_id === selected.id || e.target_node_id === selected.id,
    )
    const connectionItems = connectedEdges.map((edge) => {
      const otherId =
        edge.source_node_id === selected.id ? edge.target_node_id : edge.source_node_id
      const other = graph.nodes.find((n) => n.id === otherId)
      return {
        id: edge.id,
        title: other?.title ?? otherId,
        subtitle: RELATION_LABELS[edge.relation] ?? edge.relation,
        onClick: () => other && setSelected(other),
      }
    })

    const removeFromCanvas = {
      id: 'remove',
      label: t('panel.removeFromCanvas'),
      variant: 'outline' as const,
      icon: Trash2,
      onClick: async () => {
        if (!token) return
        if (
          !window.confirm(
            t('panel.removeConfirm', {
              defaultValue: 'Remove this node from the canvas? The underlying item is not deleted.',
            }),
          )
        ) {
          return
        }
        await deleteCanvasNode(selected.id, token)
        toast.success(t('panel.removedFromCanvas', { defaultValue: 'Removed from canvas' }))
        close()
        void refresh()
      },
    }

    if (selected.node_type === 'orchestrator') {
      return {
        ...base,
        icon: Bot,
        accentColor: '#8b5cf6',
        title: selected.title,
        subtitle: selected.subtitle,
        statusLabel: selected.status,
        description: t('panel.orchestrator.desc'),
        list: {
          heading: t('panel.connections'),
          items: connectionItems,
          emptyLabel: t('panel.connectionsEmpty'),
        },
        actions: [
          ...(selected.href
            ? [{ id: 'open', label: t('panel.orchestrator.open'), to: selected.href, variant: 'primary' as const }]
            : []),
          removeFromCanvas,
        ],
      }
    }

    if (selected.node_type === 'workstream') {
      return {
        ...base,
        icon: GitBranch,
        accentColor: '#6366f1',
        title: selected.title,
        subtitle: selected.subtitle,
        statusLabel: selected.status,
        description: t('panel.workstream.desc'),
        list: {
          heading: t('panel.connections'),
          items: connectionItems,
          emptyLabel: t('panel.connectionsEmpty'),
        },
        actions: [
          ...(selected.href
            ? [{ id: 'open', label: t('panel.workstream.open'), to: selected.href, variant: 'primary' as const }]
            : []),
          removeFromCanvas,
        ],
      }
    }

    if (selected.node_type === 'repo') {
      return {
        ...base,
        icon: FolderGit2,
        accentColor: '#22c55e',
        title: selected.title,
        subtitle: selected.subtitle,
        statusLabel: selected.status,
        description: t('panel.source.desc'),
        list: {
          heading: t('panel.connections'),
          items: connectionItems,
          emptyLabel: t('panel.connectionsEmpty'),
        },
        actions: [
          ...(selected.href
            ? [{ id: 'settings', label: t('panel.repo.settings'), to: selected.href, variant: 'primary' as const }]
            : []),
          removeFromCanvas,
        ],
      }
    }

    if (selected.node_type === 'tool') {
      return {
        ...base,
        icon: Plug,
        accentColor: '#f59e0b',
        title: selected.title,
        subtitle: selected.subtitle,
        statusLabel: selected.status,
        list: {
          heading: t('panel.connections'),
          items: connectionItems,
          emptyLabel: t('panel.connectionsEmpty'),
        },
        actions: [
          { id: 'integrations', label: t('panel.tool.open'), to: '/integrations/connected', variant: 'primary' as const, icon: ExternalLink },
          removeFromCanvas,
        ],
      }
    }

    if (selected.node_type === 'blueprint') {
      return {
        ...base,
        icon: BookOpen,
        accentColor: '#0ea5e9',
        title: selected.title,
        subtitle: selected.subtitle,
        statusLabel: selected.status,
        description: t('panel.blueprint.desc'),
        list: {
          heading: t('panel.connections'),
          items: connectionItems,
          emptyLabel: t('panel.connectionsEmpty'),
        },
        actions: [
          { id: 'open', label: t('panel.blueprint.open'), to: selected.href ?? '/os/docs', variant: 'primary' as const },
          removeFromCanvas,
        ],
      }
    }

    return null
  }, [selected, graph, token, refresh, t])

  return (
    <PageContent width="full" className="relative flex h-full min-h-0 flex-1 flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-text-heading">{t('title')}</h1>
          <p className="mt-1 text-sm text-text-muted">{t('canvasSubtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <OsAddNodeTrigger onClick={() => setPaletteOpen(true)} />
          <Button type="button" variant="outline" size="sm" onClick={handleFitView} disabled={!graph?.nodes.length}>
            <Maximize2 size={14} className="mr-1.5" aria-hidden />
            {t('actions.fitView', { defaultValue: 'Fit view' })}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void handleOrganizeLayout()}
            disabled={!graph?.nodes.length || degraded}
          >
            <LayoutGrid size={14} className="mr-1.5" aria-hidden />
            {t('actions.organizeLayout', { defaultValue: 'Organize' })}
          </Button>
          <Button type="button" variant="outline" size="sm" asChild>
            <Link to="/os/communication">{t('nodes.communication')}</Link>
          </Button>
          <Button type="button" variant="outline" size="sm" asChild>
            <Link to="/projects/new">{t('actions.newProject')}</Link>
          </Button>
        </div>
      </header>

      {degraded ? (
        <p className="rounded-lg border border-border/60 bg-bg-surface px-3 py-2 text-xs text-text-muted">
          {t('degradedNotice')}
        </p>
      ) : null}

      {error ? (
        <div className="space-y-2">
          <ApiErrorBanner message={error} />
          <Button type="button" size="sm" variant="outline" onClick={() => void refresh()}>
            {t('actions.retry')}
          </Button>
        </div>
      ) : null}

      {loading ? (
        <LoadingBlock label={t('loading')} />
      ) : (
        <div
          className="aios-canvas-shell min-h-0 flex-1"
          data-testid="os-workspace-canvas"
        >
          <div className="aios-pipeline-lanes mb-1 grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {PIPELINE_LANES.map((lane) => {
              const count = graph?.nodes.filter((n) => nodeLane(n.node_type) === lane.id).length ?? 0
              const isActive = activeLane === lane.id
              return (
              <button
                key={lane.id}
                type="button"
                onClick={() => setActiveLane(isActive ? null : lane.id)}
                className={cn(
                  'rounded-lg border px-2 py-1.5 text-center transition-colors',
                  isActive
                    ? 'border-accent/50 bg-accent/10'
                    : 'border-border/60 bg-bg-surface/40 hover:border-border hover:bg-bg-hover/40',
                )}
              >
                <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">{lane.label}</p>
                <p className="text-xs text-text-heading">{count}</p>
              </button>
            )})}
          </div>
          <p className="mb-2 shrink-0 text-[11px] text-text-muted">
            {t('pipelineFilterHint', { defaultValue: 'Click a lane to highlight matching nodes. Click again to show all.' })}
          </p>
          <div className="aios-canvas-stage min-h-0 flex-1">
            {graph?.nodes.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                <p className="text-sm text-text-muted">{t('emptyCanvas', { defaultValue: 'No nodes on the canvas yet.' })}</p>
                <Button type="button" size="sm" onClick={() => setPaletteOpen(true)}>
                  <Plus size={14} className="mr-1.5" aria-hidden />
                  {t('palette.addNode')}
                </Button>
              </div>
            ) : (
            <ReactFlow
              nodes={flowNodes}
              edges={flowEdges}
              nodeTypes={nodeTypes}
              onNodeDragStop={onNodeDragStop}
              onConnect={onConnect}
              fitView
              fitViewOptions={{ padding: CANVAS_FIT_VIEW_PADDING }}
              minZoom={0.25}
              maxZoom={1.5}
              proOptions={{ hideAttribution: true }}
              className="aios-flow-canvas rounded-xl"
              style={{ width: '100%', height: '100%' }}
            >
              <FitViewOnLoad nodeCount={flowNodes.length} />
              <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="rgba(148,163,184,0.12)" />
              <Controls showInteractive={false} className="!border-border/50 !bg-bg-surface/90" />
              <MiniMap
                className="!border-border/50 !bg-bg-surface/80"
                nodeColor="#6366f1"
                maskColor="rgba(0,0,0,0.55)"
              />
            </ReactFlow>
            )}
            {graph && graph.nodes.length > 0 ? (
            <p className="pointer-events-none absolute bottom-3 left-1/2 z-10 max-w-lg -translate-x-1/2 rounded-full border border-border/50 bg-bg-surface/90 px-3 py-1 text-center text-[11px] text-text-muted backdrop-blur-sm">
              {t('flowHint')}
            </p>
            ) : null}
          </div>
        </div>
      )}

      <OsAddNodePalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        canvasNodes={graph?.nodes ?? []}
        onAdded={() => void refresh()}
      />

      {panel ? (
        <NodeDetailPanel {...panel}>
          {selected?.node_type === 'orchestrator' ? (
            <DecisionsInline onResolved={() => void refresh()} showProjectContext />
          ) : null}
        </NodeDetailPanel>
      ) : null}
    </PageContent>
  )
}
