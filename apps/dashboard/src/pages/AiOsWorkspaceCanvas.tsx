import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BookOpen, FolderKanban, Map as MapIcon, MessageSquare, Plus, Sparkles } from 'lucide-react'
import { PageContent } from '../components/layout/PageContent'
import { LoadingBlock } from '../components/ui/loading-block'
import { ApiErrorBanner } from '../components/ui/ApiErrorBanner'
import { Button } from '../components/ui/button'
import CanvasFrame, { positionedNode, type CanvasEdge } from '../components/aios/CanvasFrame'
import NodeCard from '../components/aios/NodeCard'
import NodeDetailPanel, { type NodeDetailPanelProps } from '../components/aios/NodeDetailPanel'
import DecisionsInline from '../components/aios/DecisionsInline'
import { useOsGraph } from '../hooks/useOsGraph'
import { cn } from '../lib/utils'

type SelectedNode =
  | { kind: 'orchestra' | 'blueprint' | 'decisions' }
  | { kind: 'project'; id: string }

const NODE_W = 200
const NODE_H = 88
const COL_GAP = 40
const ROW_GAP = 32

export default function AiOsWorkspaceCanvas() {
  const { t } = useTranslation('aios')
  const navigate = useNavigate()
  const { graph, loading, error, degraded, refresh } = useOsGraph()
  const [selected, setSelected] = useState<SelectedNode | null>(null)

  const layout = useMemo(() => {
    if (!graph) return { width: 900, height: 500, edges: [] as CanvasEdge[], nodes: [] as ReactNode[] }
    const projects = graph.projects
    const cols = Math.max(1, Math.min(3, projects.length || 1))
    const rows = Math.max(1, Math.ceil(projects.length / cols))
    const width = Math.max(880, 80 + cols * (NODE_W + COL_GAP) + 80)
    const height = 200 + rows * (NODE_H + ROW_GAP) + 80

    const orchestraPos = { x: 80, y: 48, cx: 80 + NODE_W / 2, cy: 48 + NODE_H }
    const blueprintPos = { x: 80 + NODE_W + COL_GAP, y: 48, cx: 80 + NODE_W + COL_GAP + NODE_W / 2, cy: 48 + NODE_H }

    const edges: CanvasEdge[] = []
    const nodes: ReactNode[] = []

    nodes.push(
      positionedNode(
        'orchestra',
        orchestraPos.x,
        orchestraPos.y,
        <NodeCard
          kind="orchestra"
          title={t('nodes.orchestra')}
          subtitle={graph.orchestra.agent?.name ?? t('status.notConfigured')}
          statusLabel={graph.orchestra.present ? graph.orchestra.agent?.status ?? 'ready' : 'setup'}
          statusTone={graph.orchestra.present ? 'active' : 'muted'}
          icon={Sparkles}
          accentColor="#8b5cf6"
          onClick={() => setSelected({ kind: 'orchestra' })}
        />,
      ),
    )

    nodes.push(
      positionedNode(
        'blueprint',
        blueprintPos.x,
        blueprintPos.y,
        <NodeCard
          kind="blueprint"
          title={t('nodes.blueprint')}
          subtitle={
            graph.blueprint.title ??
            t('status.pageCount', { count: graph.blueprint.pageCount, defaultValue: '{{count}} pages' })
          }
          statusLabel={graph.blueprint.present ? 'ready' : 'empty'}
          statusTone={graph.blueprint.present ? 'default' : 'muted'}
          icon={BookOpen}
          accentColor="#0ea5e9"
          onClick={() => setSelected({ kind: 'blueprint' })}
        />,
      ),
    )

    projects.forEach((project, index) => {
      const col = index % cols
      const row = Math.floor(index / cols)
      const x = 80 + col * (NODE_W + COL_GAP)
      const y = 200 + row * (NODE_H + ROW_GAP)
      const cx = x + NODE_W / 2
      const cy = y + NODE_H / 2

      edges.push({
        id: `edge-orch-${project.id}`,
        from: { x: orchestraPos.cx, y: orchestraPos.cy },
        to: { x: cx, y: y },
      })
      edges.push({
        id: `edge-bp-${project.id}`,
        from: { x: blueprintPos.cx, y: blueprintPos.cy },
        to: { x: cx, y: y },
      })

      nodes.push(
        positionedNode(
          project.id,
          x,
          y,
          <NodeCard
            kind="project"
            title={project.name}
            subtitle={t('status.workstreamCount', {
              count: project.workstreamCount,
              defaultValue: '{{count}} workstreams',
            })}
            statusLabel={
              project.pendingDecisions > 0
                ? t('status.pending', { count: project.pendingDecisions })
                : project.runningRuns > 0
                  ? t('status.running', { count: project.runningRuns })
                  : project.hasOrchestrator
                    ? 'ready'
                    : 'setup'
            }
            statusTone={
              project.pendingDecisions > 0
                ? 'warning'
                : project.runningRuns > 0
                  ? 'active'
                  : 'default'
            }
            icon={FolderKanban}
            accentColor="#6366f1"
            onClick={() => setSelected({ kind: 'project', id: project.id })}
            data-testid={`os-project-node-${project.id}`}
          />,
        ),
      )
    })

    return { width, height, edges, nodes }
  }, [graph, t])

  const panel = useMemo<NodeDetailPanelProps | null>(() => {
    if (!graph || !selected) return null
    const close = () => setSelected(null)
    const base = { open: true, onClose: close }

    if (selected.kind === 'orchestra') {
      return {
        ...base,
        icon: Sparkles,
        accentColor: '#8b5cf6',
        title: t('nodes.orchestra'),
        subtitle: graph.orchestra.agent?.name ?? t('status.notConfigured'),
        statusLabel: graph.orchestra.present ? graph.orchestra.agent?.status ?? 'ready' : 'setup',
        statusTone: graph.orchestra.present ? 'active' : 'muted',
        description: t('panel.orchestra.desc'),
        actions: [{ id: 'open', label: t('panel.orchestra.open'), to: graph.orchestra.href, variant: 'primary' }],
      }
    }

    if (selected.kind === 'blueprint') {
      return {
        ...base,
        icon: BookOpen,
        accentColor: '#0ea5e9',
        title: t('nodes.blueprint'),
        subtitle:
          graph.blueprint.title ??
          t('status.pageCount', { count: graph.blueprint.pageCount, defaultValue: '{{count}} pages' }),
        statusLabel: graph.blueprint.present ? 'ready' : 'empty',
        statusTone: graph.blueprint.present ? 'default' : 'muted',
        description: t('panel.blueprint.desc'),
        rows: [{ label: t('panel.blueprint.pagesLabel'), value: graph.blueprint.pageCount }],
        actions: [{ id: 'open', label: t('panel.blueprint.open'), to: graph.blueprint.href, variant: 'primary' }],
      }
    }

    if (selected.kind === 'decisions') {
      const projectNameById = new Map(graph.projects.map((p) => [p.id, p.name]))
      return {
        ...base,
        icon: MessageSquare,
        accentColor: '#f59e0b',
        title: t('panel.decisions.workspaceTitle'),
        subtitle: t('nodes.communicationHint'),
        statusLabel:
          graph.backbone.pendingDecisions > 0
            ? t('status.pending', { count: graph.backbone.pendingDecisions })
            : 'clear',
        statusTone: graph.backbone.pendingDecisions > 0 ? 'warning' : 'default',
        description: t('panel.decisions.desc'),
        children: (
          <DecisionsInline showProjectContext projectNameById={projectNameById} onResolved={() => void refresh()} />
        ),
        actions: [
          { id: 'open', label: t('panel.decisions.openThread'), to: '/os/communication', variant: 'outline' },
        ],
      }
    }

    if (selected.kind !== 'project') return null
    const project = graph.projects.find((p) => p.id === selected.id)
    if (!project) return null
    return {
      ...base,
      icon: FolderKanban,
      accentColor: '#6366f1',
      title: project.name,
      subtitle: t('status.workstreamCount', { count: project.workstreamCount, defaultValue: '{{count}} workstreams' }),
      statusLabel:
        project.pendingDecisions > 0
          ? t('status.pending', { count: project.pendingDecisions })
          : project.runningRuns > 0
            ? t('status.running', { count: project.runningRuns })
            : project.hasOrchestrator
              ? 'ready'
              : 'setup',
      statusTone:
        project.pendingDecisions > 0 ? 'warning' : project.runningRuns > 0 ? 'active' : 'default',
      rows: [
        { label: t('panel.project.workstreams'), value: project.workstreamCount },
        { label: t('panel.project.repo'), value: project.repoFullName ?? project.repoStatus },
        { label: t('panel.project.runningRuns'), value: project.runningRuns },
        { label: t('panel.project.pendingDecisions'), value: project.pendingDecisions },
      ],
      list: {
        heading: t('panel.project.quickLinks'),
        emptyLabel: '',
        items: [
          {
            id: 'orchestrator',
            title: t('nodes.orchestrator'),
            to: `/project/${project.id}/orchestrator`,
          },
          {
            id: 'workstreams',
            title: t('actions.openOverview'),
            to: `/project/${project.id}/overview`,
          },
          {
            id: 'decisions',
            title: t('nodes.communication'),
            statusLabel: project.pendingDecisions > 0 ? String(project.pendingDecisions) : undefined,
            statusTone: project.pendingDecisions > 0 ? ('warning' as const) : undefined,
            to: `/project/${project.id}/communication`,
          },
          {
            id: 'settings',
            title: t('panel.repo.settings'),
            to: `/project/${project.id}/settings`,
          },
        ],
      },
      actions: [
        {
          id: 'open',
          label: t('panel.project.openMap'),
          onClick: () => {
            close()
            navigate(`/os/project/${project.id}`)
          },
          variant: 'primary',
          icon: MapIcon,
        },
      ],
    }
  }, [graph, selected, navigate, refresh, t])

  return (
    <PageContent width="full" className="relative flex min-h-0 flex-1 flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-text-heading">{t('title')}</h1>
          <p className="mt-1 text-sm text-text-muted">{t('subtitle')}</p>
        </div>
        <Button type="button" variant="outline" size="sm" asChild>
          <Link to="/projects/new">
            <Plus size={14} className="mr-1.5" />
            {t('actions.newProject')}
          </Link>
        </Button>
      </header>

      {degraded ? (
        <p className="rounded-lg border border-border/60 bg-bg-surface px-3 py-2 text-xs text-text-muted">
          {t('degradedNotice')}
        </p>
      ) : null}

      {graph ? (
        <div
          className="grid grid-cols-2 gap-3 rounded-xl border border-border/45 bg-bg-surface/50 p-3 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset] backdrop-blur-sm sm:grid-cols-4"
          data-testid="os-backbone-strip"
        >
          <BackboneStat
            label={t('backbone.runningRuns')}
            value={graph.backbone.runningRuns}
            onClick={() => navigate('/os/agents')}
          />
          <BackboneStat
            label={t('backbone.pendingDecisions')}
            value={graph.backbone.pendingDecisions}
            onClick={() => setSelected({ kind: 'decisions' })}
            highlight={graph.backbone.pendingDecisions > 0}
          />
          <BackboneStat
            label={t('backbone.activeAgents')}
            value={graph.backbone.activeAgents}
            onClick={() => navigate('/os/agents')}
          />
          <BackboneStat
            label={t('backbone.projects')}
            value={graph.backbone.projectCount}
            onClick={() => {
              const first = graph.projects[0]
              if (first) navigate(`/os/project/${first.id}`)
            }}
          />
        </div>
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
          hint={t('canvasHint')}
          data-testid="os-workspace-canvas"
        >
          {layout.nodes}
          {!graph?.projects.length ? (
            <div className="absolute left-20 top-[200px] max-w-md space-y-3">
              <p className="text-sm text-text-muted">{t('emptyProjects')}</p>
              <Button type="button" size="sm" asChild>
                <Link to="/projects/new">
                  <Plus size={14} className="mr-1.5" />
                  {t('actions.newProject')}
                </Link>
              </Button>
            </div>
          ) : null}
        </CanvasFrame>
      )}

      {panel ? <NodeDetailPanel {...panel} /> : null}
    </PageContent>
  )
}

function BackboneStat({
  label,
  value,
  onClick,
  highlight = false,
}: {
  label: string
  value: number
  onClick?: () => void
  highlight?: boolean
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'rounded-md text-left transition-colors',
        onClick && 'cursor-pointer hover:bg-bg-hover/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">{label}</p>
      <p
        className={cn(
          'text-xl font-semibold',
          highlight && value > 0 ? 'text-status-warning' : 'text-text-heading',
        )}
      >
        {value}
      </p>
    </Tag>
  )
}
