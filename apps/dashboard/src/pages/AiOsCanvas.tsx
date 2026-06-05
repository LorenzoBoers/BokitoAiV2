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
  Plug,
  Trash2,
} from 'lucide-react'
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

function nodeLane(nodeType: OsCanvasNode['node_type']): string {
  if (nodeType === 'orchestrator' || nodeType === 'workstream') return 'orchestration'
  if (nodeType === 'tool' || nodeType === 'repo') return 'integration'
  if (nodeType === 'blueprint') return 'interpretation'
  return 'orchestration'
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
  const { graph, loading, error, degraded, refresh } = useOsGraph()
  const [pendingChanges, setPendingChanges] = useState<PlatformChangeRow[]>([])
  const [selected, setSelected] = useState<OsCanvasNode | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)

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
      } satisfies OsFlowNodeData,
      draggable: true,
    }))
  }, [graph, selected?.id, onSelectNode, pendingRefIds])

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
        void refresh()
      } catch {
        // invalid connection silently ignored; API validates
      }
    },
    [token, graph, degraded, refresh],
  )

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
        await deleteCanvasNode(selected.id, token)
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
    <PageContent width="full" className="relative flex min-h-0 flex-1 flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-text-heading">{t('title')}</h1>
          <p className="mt-1 text-sm text-text-muted">{t('canvasSubtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <OsAddNodeTrigger onClick={() => setPaletteOpen(true)} />
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
          className="aios-canvas-shell min-h-[560px] flex-1"
          data-testid="os-workspace-canvas"
        >
          <div className="aios-pipeline-lanes mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {PIPELINE_LANES.map((lane) => (
              <div
                key={lane.id}
                className="rounded-lg border border-border/60 bg-bg-surface/40 px-2 py-1.5 text-center"
              >
                <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">{lane.label}</p>
                <p className="text-xs text-text-heading">
                  {graph?.nodes.filter((n) => nodeLane(n.node_type) === lane.id).length ?? 0}
                </p>
              </div>
            ))}
          </div>
          <p className="aios-canvas-hint">{t('flowHint')}</p>
          <div className="aios-canvas-stage h-[min(72vh,720px)]">
            <ReactFlow
              nodes={flowNodes}
              edges={flowEdges}
              nodeTypes={nodeTypes}
              onNodeDragStop={onNodeDragStop}
              onConnect={onConnect}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              minZoom={0.3}
              maxZoom={1.5}
              proOptions={{ hideAttribution: true }}
              className="aios-flow-canvas rounded-xl"
            >
              <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="rgba(148,163,184,0.12)" />
              <Controls showInteractive={false} className="!border-border/50 !bg-bg-surface/90" />
              <MiniMap
                className="!border-border/50 !bg-bg-surface/80"
                nodeColor="#6366f1"
                maskColor="rgba(0,0,0,0.55)"
              />
            </ReactFlow>
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
