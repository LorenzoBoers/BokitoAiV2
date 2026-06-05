import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  BookOpen,
  Bot,
  ExternalLink,
  FolderGit2,
  GitBranch,
  Settings,
  Sparkles,
} from 'lucide-react'
import { PageContent } from '../components/layout/PageContent'
import { LoadingBlock } from '../components/ui/loading-block'
import { ApiErrorBanner } from '../components/ui/ApiErrorBanner'
import { Button } from '../components/ui/button'
import CanvasFrame, { positionedNode, type CanvasEdge } from '../components/aios/CanvasFrame'
import NodeCard from '../components/aios/NodeCard'
import NodeDetailPanel, { type NodeDetailPanelProps } from '../components/aios/NodeDetailPanel'
import { useOptionalProjectHubNav } from '../context/ProjectHubNavContext'
import { useOsProjectGraph } from '../hooks/useOsProjectGraph'
import { projectOverviewPath } from '../components/layout/portal-nav'
import { ASSISTENT_DEFAULT_PATH } from '../lib/assistent-settings-path'

const NODE_W = 200
const NODE_H = 88
const CONTEXT_GAP = 56
const WS_COL_GAP = 40
const WS_ROW_GAP = 28
const SOURCE_GAP = 40
const TOP_Y = 36
const ROW_V_GAP = 104
const MARGIN_X = 96
const WS_MAX_COLS = 4

type SelectedNode =
  | { kind: 'orchestrator' | 'assistant' | 'blueprint' | 'source' }
  | { kind: 'workstream'; id: string }

function rowWidth(count: number, gap: number): number {
  if (count <= 0) return 0
  return count * NODE_W + (count - 1) * gap
}

function rowStartX(count: number, gap: number, canvasWidth: number): number {
  return Math.round((canvasWidth - rowWidth(count, gap)) / 2)
}

export default function AiOsProjectCanvas() {
  const { projectId } = useParams<{ projectId: string }>()
  const { t } = useTranslation('aios')
  const navigate = useNavigate()
  const projectHubNav = useOptionalProjectHubNav()
  const { graph, loading, error, degraded, refresh } = useOsProjectGraph(projectId)
  const [selected, setSelected] = useState<SelectedNode | null>(null)

  useEffect(() => {
    if (projectId) projectHubNav?.setSelectedProjectId(projectId)
  }, [projectId, projectHubNav])

  const layout = useMemo(() => {
    if (!graph) return { width: 960, height: 560, edges: [] as CanvasEdge[], nodes: [] as ReactNode[] }

    const workstreams = graph.workstreams
    const wsCount = workstreams.length
    const wsCols = Math.min(WS_MAX_COLS, Math.max(1, wsCount || 1))
    const wsRows = Math.max(1, Math.ceil((wsCount || 1) / wsCols))

    // One source per connected/known repo. Future: multiple sources with per-workstream links.
    const sources = [
      {
        id: 'repo',
        title: t('nodes.source'),
        name: graph.repo.fullName ?? t('status.notConnected'),
        status: graph.repo.status,
        connected: graph.repo.status !== 'none',
        linkedWorkstreamIds: workstreams.map((w) => w.id),
      },
    ]

    const topWidth = rowWidth(3, CONTEXT_GAP)
    const wsRowWidth = rowWidth(wsCols, WS_COL_GAP)
    const srcRowWidth = rowWidth(sources.length, SOURCE_GAP)
    const width = Math.max(960, MARGIN_X * 2 + Math.max(topWidth, wsRowWidth, srcRowWidth))

    const orchX = Math.round(width / 2 - NODE_W / 2)
    const orchCx = orchX + NODE_W / 2
    const orchBottomY = TOP_Y + NODE_H

    const assistantX = orchX - (NODE_W + CONTEXT_GAP)
    const blueprintX = orchX + (NODE_W + CONTEXT_GAP)
    const contextMidY = TOP_Y + NODE_H / 2

    const wsStartY = TOP_Y + NODE_H + ROW_V_GAP
    const srcY = wsStartY + wsRows * (NODE_H + WS_ROW_GAP) - WS_ROW_GAP + ROW_V_GAP
    const height = Math.max(560, srcY + NODE_H + 56)

    const edges: CanvasEdge[] = []
    const nodes: ReactNode[] = []

    // Context nodes feed the orchestrator.
    edges.push({
      id: 'edge-assistant-orch',
      from: { x: assistantX + NODE_W, y: contextMidY },
      to: { x: orchX, y: contextMidY },
    })
    edges.push({
      id: 'edge-blueprint-orch',
      from: { x: blueprintX, y: contextMidY },
      to: { x: orchX + NODE_W, y: contextMidY },
    })

    nodes.push(
      positionedNode(
        'assistant',
        assistantX,
        TOP_Y,
        <NodeCard
          kind="assistant"
          title={t('nodes.assistant')}
          subtitle={t('nodes.assistantHint')}
          statusLabel="ready"
          statusTone="default"
          icon={Sparkles}
          accentColor="#a855f7"
          onClick={() => setSelected({ kind: 'assistant' })}
        />,
      ),
    )

    nodes.push(
      positionedNode(
        'orchestrator',
        orchX,
        TOP_Y,
        <NodeCard
          kind="orchestrator"
          title={t('nodes.orchestrator')}
          subtitle={graph.orchestrator.agent?.name ?? t('status.notLinked')}
          statusLabel={graph.orchestrator.present ? 'linked' : 'setup'}
          statusTone={graph.orchestrator.present ? 'active' : 'warning'}
          icon={Bot}
          accentColor="#8b5cf6"
          onClick={() => setSelected({ kind: 'orchestrator' })}
        />,
      ),
    )

    nodes.push(
      positionedNode(
        'blueprint',
        blueprintX,
        TOP_Y,
        <NodeCard
          kind="blueprint"
          title={t('nodes.blueprint')}
          subtitle={t('nodes.blueprintHint')}
          statusLabel="shared"
          statusTone="muted"
          icon={BookOpen}
          accentColor="#0ea5e9"
          onClick={() => setSelected({ kind: 'blueprint' })}
        />,
      ),
    )

    // Workstreams fan out from the orchestrator, centered per row.
    const wsCenters = new Map<string, { cx: number; topY: number; bottomY: number }>()
    workstreams.forEach((ws, index) => {
      const row = Math.floor(index / wsCols)
      const colCount = Math.min(wsCols, wsCount - row * wsCols)
      const colIndex = index - row * wsCols
      const startX = rowStartX(colCount, WS_COL_GAP, width)
      const x = startX + colIndex * (NODE_W + WS_COL_GAP)
      const y = wsStartY + row * (NODE_H + WS_ROW_GAP)
      const cx = x + NODE_W / 2
      wsCenters.set(ws.id, { cx, topY: y, bottomY: y + NODE_H })

      edges.push({
        id: `edge-orch-ws-${ws.id}`,
        from: { x: orchCx, y: orchBottomY },
        to: { x: cx, y },
      })

      nodes.push(
        positionedNode(
          ws.id,
          x,
          y,
          <NodeCard
            kind="workstream"
            title={ws.name}
            subtitle={ws.slug}
            statusLabel={ws.status}
            statusTone={ws.status === 'active' ? 'active' : ws.status === 'paused' ? 'warning' : 'muted'}
            icon={GitBranch}
            accentColor="#6366f1"
            onClick={() => setSelected({ kind: 'workstream', id: ws.id })}
          />,
        ),
      )
    })

    // Sources sit at the bottom and link up to the orchestrator and the workstreams they power.
    const srcStartX = rowStartX(sources.length, SOURCE_GAP, width)
    sources.forEach((source, index) => {
      const x = srcStartX + index * (NODE_W + SOURCE_GAP)
      const cx = x + NODE_W / 2
      const topY = srcY

      edges.push({
        id: `edge-src-orch-${source.id}`,
        from: { x: cx, y: topY },
        to: { x: orchCx, y: orchBottomY },
      })
      source.linkedWorkstreamIds.forEach((wsId) => {
        const center = wsCenters.get(wsId)
        if (!center) return
        edges.push({
          id: `edge-src-${source.id}-ws-${wsId}`,
          from: { x: cx, y: topY },
          to: { x: center.cx, y: center.bottomY },
        })
      })

      nodes.push(
        positionedNode(
          source.id,
          x,
          topY,
          <NodeCard
            kind="source"
            title={source.title}
            subtitle={source.name}
            statusLabel={source.status}
            statusTone={source.connected ? 'active' : 'muted'}
            icon={FolderGit2}
            accentColor="#22c55e"
            onClick={() => setSelected({ kind: 'source' })}
          />,
        ),
      )
    })

    return { width, height, edges, nodes }
  }, [graph, t])

  const overviewHref = projectId ? projectOverviewPath(projectId) : '/os'

  const panel = useMemo<NodeDetailPanelProps | null>(() => {
    if (!graph || !selected) return null
    const close = () => setSelected(null)
    const base = { open: true, onClose: close }

    if (selected.kind === 'orchestrator') {
      const pending = graph.communication.pendingDecisions
      return {
        ...base,
        icon: Bot,
        accentColor: '#8b5cf6',
        title: t('nodes.orchestrator'),
        subtitle: graph.orchestrator.agent?.name ?? t('status.notLinked'),
        statusLabel: graph.orchestrator.present ? 'linked' : 'setup',
        statusTone: graph.orchestrator.present ? 'active' : 'warning',
        description: t('panel.orchestrator.desc'),
        list: {
          heading: t('panel.project.quickLinks'),
          emptyLabel: '',
          items: [
            { id: 'workstreams', title: t('actions.openOverview'), to: overviewHref },
            { id: 'runs', title: t('panel.runs.openAll'), to: graph.runs.href },
            {
              id: 'decisions',
              title: t('nodes.communication'),
              statusLabel: pending > 0 ? String(pending) : undefined,
              statusTone: pending > 0 ? ('warning' as const) : undefined,
              to: graph.communication.href,
            },
          ],
        },
        actions: [
          {
            id: 'open',
            label: graph.orchestrator.present
              ? t('panel.orchestrator.open')
              : t('panel.orchestrator.setup'),
            to: graph.orchestrator.href,
            variant: 'primary',
            icon: Settings,
          },
        ],
      }
    }

    if (selected.kind === 'assistant') {
      return {
        ...base,
        icon: Sparkles,
        accentColor: '#a855f7',
        title: t('nodes.assistant'),
        subtitle: t('nodes.assistantHint'),
        statusLabel: 'ready',
        statusTone: 'default',
        description: t('panel.assistant.desc'),
        actions: [
          { id: 'open', label: t('panel.assistant.open'), to: ASSISTENT_DEFAULT_PATH, variant: 'primary' },
        ],
      }
    }

    if (selected.kind === 'blueprint') {
      return {
        ...base,
        icon: BookOpen,
        accentColor: '#0ea5e9',
        title: t('nodes.blueprint'),
        subtitle: t('nodes.blueprintHint'),
        statusLabel: 'shared',
        statusTone: 'muted',
        description: t('panel.blueprint.desc'),
        actions: [{ id: 'open', label: t('panel.blueprint.open'), to: '/os/docs', variant: 'primary' }],
      }
    }

    if (selected.kind === 'workstream') {
      const ws = graph.workstreams.find((w) => w.id === selected.id)
      if (!ws) return null
      return {
        ...base,
        icon: GitBranch,
        accentColor: '#6366f1',
        title: ws.name,
        subtitle: ws.slug,
        statusLabel: ws.status,
        statusTone: ws.status === 'active' ? 'active' : ws.status === 'paused' ? 'warning' : 'muted',
        description: t('panel.workstream.desc'),
        actions: [{ id: 'open', label: t('panel.workstream.open'), to: ws.href, variant: 'primary' }],
      }
    }

    // source (repository / external source)
    const connected = graph.repo.status !== 'none'
    return {
      ...base,
      icon: FolderGit2,
      accentColor: '#22c55e',
      title: t('nodes.source'),
      subtitle: graph.repo.fullName ?? t('status.notConnected'),
      statusLabel: graph.repo.status,
      statusTone: connected ? 'active' : 'muted',
      description: t('panel.source.desc'),
      rows: [
        { label: t('panel.repo.statusLabel'), value: graph.repo.status },
        { label: t('panel.repo.repoLabel'), value: graph.repo.fullName ?? '—' },
        { label: t('panel.source.linkedLabel'), value: graph.workstreams.length },
      ],
      actions: [
        { id: 'settings', label: t('panel.repo.settings'), to: graph.repo.href, variant: 'primary', icon: Settings },
        ...(graph.repo.fullName
          ? [
              {
                id: 'github',
                label: t('panel.repo.viewGithub'),
                to: `https://github.com/${graph.repo.fullName}`,
                variant: 'outline' as const,
                external: true,
                icon: ExternalLink,
              },
            ]
          : []),
      ],
    }
  }, [graph, selected, overviewHref, t])

  return (
    <PageContent width="full" className="relative flex min-h-0 flex-1 flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Button type="button" variant="ghost" size="sm" asChild className="shrink-0">
            <Link to="/os">
              <ArrowLeft size={16} className="mr-1" />
              {t('backToWorkspace')}
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-semibold text-text-heading">
              {graph?.project.name ?? t('projectCanvas')}
            </h1>
            <p className="text-sm text-text-muted">{t('projectSubtitle')}</p>
          </div>
        </div>
        {projectId ? (
          <Button type="button" variant="outline" size="sm" asChild>
            <Link to={overviewHref}>{t('actions.openOverview')}</Link>
          </Button>
        ) : null}
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
        <CanvasFrame
          width={layout.width}
          height={layout.height}
          edges={layout.edges}
          hint={t('projectCanvasHint')}
          data-testid="os-project-canvas"
        >
          {layout.nodes}
        </CanvasFrame>
      )}

      {panel ? <NodeDetailPanel {...panel} /> : null}
    </PageContent>
  )
}
