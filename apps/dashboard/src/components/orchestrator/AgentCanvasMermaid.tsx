import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Activity, Bot, Loader2, MessageSquare, Pause, Play, Settings } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Card, CardContent } from '../ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Textarea } from '../ui/textarea'
import {
  type AgentNodeStatus,
  type WorkforceViewState,
  type SessionEntry,
  type WorkforceNode,
} from '../../lib/workforce-graph'
import WorkforceHeader from './WorkforceHeader'
import WorkforceTimeline from './WorkforceTimeline'
import { useWorkforceData } from '../../hooks/useWorkforceData'
import { useWorkforceRealtime } from '../../hooks/useWorkforceRealtime'

interface Props {
  token: string
  pipelineId?: number
  onOpenControl?: () => void
  onOpenAssistantConfig?: () => void
  tenantName?: string
}

const NODE_CARD_WIDTH = 180
const COMPACT_NODE_CARD_WIDTH = 168

function formatTs(value: number | undefined): string {
  if (!value) return '-'
  const d = new Date(value)
  if (isNaN(d.getTime())) return '-'
  return d.toLocaleString('nl-NL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}


function statusTone(status: AgentNodeStatus): { dot: string; border: string; label?: string } {
  if (status === 'active') return { dot: 'bg-status-success', border: 'border-status-success/70', label: 'Actief' }
  if (status === 'awaiting') return { dot: 'bg-status-info', border: 'border-status-info/70', label: 'Wacht op' }
  if (status === 'activating') return { dot: 'bg-status-warning', border: 'border-status-warning/60', label: 'Initializing' }
  if (status === 'standby') return { dot: 'bg-text-muted', border: 'border-border', label: 'Standby' }
  if (status === 'error') return { dot: 'bg-status-error', border: 'border-status-error/60', label: 'Fout' }
  if (status === 'disabled') return { dot: 'bg-text-muted', border: 'border-border', label: 'Uitgeschakeld' }
  return { dot: 'bg-text-muted', border: 'border-border' }
}

/** Icon + typography aligned with card border tone; disabled uses border gray only. */
function nodeContentTone(node: WorkforceNode): {
  icon: string
  title: string
  role: string
  subtitle: string
  spinner: string
} {
  if (node.status === 'disabled') {
    return {
      icon: 'text-text-muted',
      title: 'text-text-muted',
      role: 'text-text-muted',
      subtitle: 'text-text-muted',
      spinner: 'text-text-muted',
    }
  }
  if (node.status === 'standby') {
    return {
      icon: 'text-text-muted',
      title: 'text-text-muted',
      role: 'text-text-muted',
      subtitle: 'text-text-muted',
      spinner: 'text-text-muted',
    }
  }
  if (node.status === 'error') {
    return {
      icon: 'text-status-error',
      title: 'text-status-error',
      role: 'text-status-error/75',
      subtitle: 'text-status-error/85',
      spinner: 'text-status-error/80',
    }
  }
  if (node.status === 'activating') {
    return {
      icon: 'text-status-warning',
      title: 'text-status-warning',
      role: 'text-status-warning/70',
      subtitle: 'text-status-warning/85',
      spinner: 'text-status-warning/80',
    }
  }
  if (node.status === 'awaiting') {
    return {
      icon: 'text-status-info',
      title: 'text-status-info',
      role: 'text-status-info/75',
      subtitle: 'text-status-info/85',
      spinner: 'text-status-info/80',
    }
  }
  if (node.status === 'active') {
    const c = 'text-status-success'
    return {
      icon: c,
      title: c,
      role: 'text-status-success/75',
      subtitle: 'text-status-success/85',
      spinner: 'text-status-success/80',
    }
  }
  return {
    icon: 'text-text-secondary',
    title: 'text-text-heading',
    role: 'text-text-muted',
    subtitle: 'text-text-secondary',
    spinner: 'text-text-secondary',
  }
}

function TreeStem({ className }: { className?: string }) {
  return <div className={`mx-auto h-6 w-0.5 shrink-0 rounded-full bg-border/90 ${className ?? ''}`} aria-hidden />
}

/** Connectors that always snap to exact child card centers. */
function TreeFork({ centers, width }: { centers: number[]; width: number }) {
  if (centers.length < 2) return null
  const joinY = 11
  const centerX = width / 2
  const leftX = Math.min(...centers)
  const rightX = Math.max(...centers)
  const path = [
    `M ${centerX} 0 V ${joinY}`,
    `M ${leftX} ${joinY} H ${rightX}`,
    ...centers.map((x) => `M ${x} ${joinY} V 30`),
  ].join(' ')

  return (
    <svg viewBox={`0 0 ${width} 30`} style={{ width, height: 28 }} className="shrink-0 text-border" preserveAspectRatio="none" aria-hidden>
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.92}
      />
    </svg>
  )
}

function parseHistoryHeadline(actionType: string): { role: string | null; detail: string } {
  const idx = actionType.indexOf(':')
  if (idx <= 0 || idx >= actionType.length - 1) return { role: null, detail: actionType }
  const role = actionType.slice(0, idx).trim()
  const detail = actionType.slice(idx + 1).trim()
  if (!role || !detail) return { role: null, detail: actionType }
  return { role, detail }
}

function historyRoleBadgeVariant(role: string): 'success' | 'info' | 'warning' | 'accent' | 'neutral' {
  const r = role.toLowerCase()
  if (r.includes('builder')) return 'success'
  if (r.includes('test')) return 'info'
  if (r.includes('audit')) return 'warning'
  if (r.includes('manager') || r.includes('product') || r.includes('legal') || r.includes('assistent'))
    return 'accent'
  return 'neutral'
}

function historyDotClass(level: string): string {
  const lv = level.toLowerCase()
  if (lv === 'error') return 'border-bg-elevated bg-status-error ring-2 ring-status-error/25'
  if (lv === 'warn' || lv === 'warning')
    return 'border-bg-elevated bg-status-warning ring-2 ring-status-warning/25'
  return 'border-bg-elevated bg-accent shadow-sm ring-2 ring-border/40'
}

function SessionLog({ entries }: { entries: SessionEntry[] }) {
  if (!entries.length) return <p className="text-xs text-text-muted">Nog geen activiteit.</p>
  const slice = entries.slice(0, 60)
  return (
    <div className="h-full overflow-y-auto pr-1">
      <div className="relative">
        <div
          className="pointer-events-none absolute left-[10px] top-3 bottom-3 w-px rounded-full bg-gradient-to-b from-transparent via-border/55 to-transparent"
          aria-hidden
        />
        <ul className="relative m-0 list-none p-0">
          {slice.map((entry) => {
            const { role, detail } = parseHistoryHeadline(entry.actionType)
            return (
              <li key={entry.id} className="group flex gap-3 pb-4 last:pb-0">
                <div className="relative z-[1] flex w-5 shrink-0 justify-center pt-[6px]">
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full border-2 ${historyDotClass(entry.level)}`}
                    aria-hidden
                  />
                </div>
                <div className="min-w-0 flex-1 rounded-lg px-2 py-1.5 -mx-1 transition-colors group-hover:bg-bg-surface/55">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex flex-wrap items-center gap-1.5 gap-y-1">
                      {role ? (
                        <>
                          <Badge variant={historyRoleBadgeVariant(role)} className="max-w-[120px] truncate font-semibold">
                            {role}
                          </Badge>
                          <span className="text-xs font-semibold text-text-heading leading-snug">{detail}</span>
                        </>
                      ) : (
                        <span className="text-xs font-semibold text-text-heading leading-snug">{entry.actionType}</span>
                      )}
                    </div>
                    <time
                      className="text-2xs tabular-nums text-text-muted shrink-0 pt-0.5"
                      dateTime={new Date(entry.createdAt).toISOString()}
                    >
                      {formatTs(entry.createdAt)}
                    </time>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-text-secondary pl-0">{entry.message}</p>
                </div>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

function FeatureQueue({ features }: { features: WorkforceViewState['features'] }) {
  if (features.length === 0) return <p className="text-xs text-text-muted">Geen features in queue.</p>
  return (
    <div className="space-y-1">
      {features.slice(0, 40).map((feature) => (
        <div key={feature.id} className="flex items-center justify-between px-2 py-1.5 rounded text-xs border border-border/50">
          <span className="text-text-primary font-medium truncate max-w-[210px]">{feature.name}</span>
          <span className="inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-semibold bg-bg-elevated text-text-secondary">
            {feature.status}
          </span>
        </div>
      ))}
    </div>
  )
}

function AgentNodeCard({
  node,
  subtitle,
  onSetStatus,
  onRequestTrigger,
  onConfig,
  compact = false,
  timelineHighlightAgentId,
}: {
  node: WorkforceNode
  subtitle?: string
  onSetStatus: (node: WorkforceNode, status: 'active' | 'standby', instructionOverride?: string) => void
  onRequestTrigger: (node: WorkforceNode) => void
  onConfig: (node: WorkforceNode) => void
  compact?: boolean
  timelineHighlightAgentId?: string | null
}) {
  const [hovered, setHovered] = useState(false)
  const tone = statusTone(node.status)
  const content = nodeContentTone(node)
  const canActivate = node.status === 'disabled' || node.status === 'standby'
  const cardWidth = compact ? COMPACT_NODE_CARD_WIDTH : NODE_CARD_WIDTH
  const fallbackSubtitle =
    node.status === 'active'
      ? 'Actieve sessie'
      : node.status === 'activating'
        ? 'Initializing'
        : node.status === 'awaiting'
          ? 'Wacht op child agent'
          : node.status === 'standby'
            ? 'Standby'
            : 'Geen actieve sessie'
  const displaySubtitle = subtitle ?? node.currentActivity ?? fallbackSubtitle
  const showSpinner = node.status === 'active' || node.status === 'activating'
  const normalizedLabel = node.label.trim().toLowerCase()
  const normalizedRoleName = node.roleName.trim().toLowerCase()
  const shouldShowRoleName = normalizedRoleName.length > 0 && normalizedRoleName !== normalizedLabel
  const statusLabel = tone.label ?? 'Uitgeschakeld'
  const statusVariant: 'neutral' | 'warning' | 'accent' | 'success' | 'error' =
    node.status === 'standby'
      ? 'neutral'
      : node.status === 'activating'
        ? 'warning'
        : node.status === 'awaiting'
          ? 'accent'
        : node.status === 'active'
          ? 'success'
          : node.status === 'error'
            ? 'error'
            : 'neutral'

  const timelineLinked = Boolean(timelineHighlightAgentId && timelineHighlightAgentId === node.id)

  return (
    <div
      className={`relative shrink-0 ${timelineLinked ? 'z-20' : ''}`}
      style={{ width: cardWidth }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {hovered && (
        <div className="absolute bottom-full left-1/2 z-30 -translate-x-1/2">
          <div className="min-w-[210px] max-w-[240px] rounded-md border border-border bg-bg-elevated/95 px-2.5 py-2 shadow-md">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-text-primary truncate">{node.label}</p>
              <Badge variant={statusVariant}>{statusLabel}</Badge>
            </div>
            <p className="mt-0.5 text-2xs text-text-muted truncate">{node.roleName || 'Geen rol ingesteld'}</p>
            <p className="mt-1 text-xs leading-relaxed text-text-secondary line-clamp-2">{displaySubtitle}</p>
          </div>
        </div>
      )}

      <Card
        className={`border-2 ${tone.border} bg-bg-surface shadow-sm transition-all duration-200 ${
          timelineLinked ? 'ring-2 ring-accent ring-offset-2 ring-offset-bg-surface shadow-md' : ''
        } ${hovered ? 'shadow-md scale-[1.02]' : ''}`}
      >
        <CardContent className="px-3 py-2">
          <span
            className={`absolute top-2.5 right-2.5 h-2.5 w-2.5 rounded-full ${tone.dot} ${
              node.status === 'active' || node.status === 'activating' ? 'animate-pulse' : ''
            }`}
          />
          <div className="flex flex-col items-center text-center gap-0.5">
            <Bot className={`h-4 w-4 shrink-0 ${content.icon}`} strokeWidth={2} />
            <div className={`text-sm font-semibold truncate max-w-full ${content.title}`}>{node.label}</div>
            {shouldShowRoleName ? <div className={`text-2xs truncate max-w-full ${content.role}`}>{node.roleName}</div> : null}
            <div className="mt-0.5 min-h-[1rem] w-full flex items-start justify-center gap-1">
              {showSpinner ? <Loader2 size={10} className={`mt-0.5 shrink-0 animate-spin ${content.spinner}`} /> : null}
              <p className={`text-xs line-clamp-1 text-center ${content.subtitle}`}>{displaySubtitle}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {hovered && (
        <div className="absolute top-full left-1/2 z-30 -translate-x-1/2 pt-0.5">
          <div className="flex items-center gap-1.5 rounded-full border border-border bg-bg-elevated/95 px-2 py-1 shadow-md whitespace-nowrap">
            <button
              type="button"
              onClick={() => {
                if (!canActivate) {
                  onSetStatus(node, 'standby')
                  return
                }
                onRequestTrigger(node)
              }}
              className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full transition-colors hover:bg-bg-hover ${canActivate ? 'text-status-success' : 'text-text-muted'}`}
            >
              {canActivate ? <Play size={10} /> : <Pause size={10} />}
              {canActivate ? 'Trigger' : 'Standby'}
            </button>
            <div className="w-px h-3 bg-border" />
            <button
              type="button"
              onClick={() => onConfig(node)}
              className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-full text-text-muted hover:bg-bg-hover hover:text-text-primary transition-colors"
            >
              <Settings size={10} />
              Config
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function WorkforceTree({
  manager,
  productowner,
  legal,
  builder,
  tester,
  auditor,
  onSetStatus,
  onRequestTrigger,
  onConfig,
  timelineHighlightAgentId,
}: {
  manager: WorkforceNode | null
  productowner: WorkforceNode | null
  legal: WorkforceNode | null
  builder: WorkforceNode | null
  tester: WorkforceNode | null
  auditor: WorkforceNode | null
  onSetStatus: (node: WorkforceNode, status: 'active' | 'standby', instructionOverride?: string) => void
  onRequestTrigger: (node: WorkforceNode) => void
  onConfig: (node: WorkforceNode) => void
  timelineHighlightAgentId?: string | null
}) {
  if (!manager) {
    return <div className="h-full flex items-center justify-center text-sm text-text-muted">Geen manager agent gevonden.</div>
  }

  const topGap = 24
  const workerGap = 14
  const topNodes = [productowner, legal].filter((node): node is WorkforceNode => Boolean(node))
  const workerNodes = [builder, tester, auditor].filter((node): node is WorkforceNode => Boolean(node))
  const topRowWidth = Math.max(NODE_CARD_WIDTH, topNodes.length * NODE_CARD_WIDTH + Math.max(0, topNodes.length - 1) * topGap)
  const workerRowWidth = Math.max(
    COMPACT_NODE_CARD_WIDTH,
    workerNodes.length * COMPACT_NODE_CARD_WIDTH + Math.max(0, workerNodes.length - 1) * workerGap,
  )
  const topCenters = topNodes.map((_, index) => index * (NODE_CARD_WIDTH + topGap) + NODE_CARD_WIDTH / 2)
  const workerCenters = workerNodes.map((_, index) => index * (COMPACT_NODE_CARD_WIDTH + workerGap) + COMPACT_NODE_CARD_WIDTH / 2)

  return (
    <div className="h-full min-h-0 overflow-auto px-2 pb-14">
      <div className="mx-auto flex w-full min-w-0 max-w-3xl flex-col items-center">
        <div className="text-sm font-medium text-text-secondary text-center">Jij</div>
        <TreeStem />
        <div className="flex flex-col items-center text-accent">
          <MessageSquare size={16} className="shrink-0" />
          <div className="text-sm font-semibold mt-1 text-center">Assistent</div>
        </div>
        <TreeStem />

        <AgentNodeCard
          node={manager}
          onSetStatus={onSetStatus}
          onRequestTrigger={onRequestTrigger}
          onConfig={onConfig}
          timelineHighlightAgentId={timelineHighlightAgentId}
        />
        <TreeStem className="mt-2" />
        {topNodes.length > 1 ? <TreeFork centers={topCenters} width={topRowWidth} /> : <TreeStem />}

        <div className="mt-1 flex shrink-0 items-start justify-center" style={{ width: topRowWidth, gap: topGap }}>
          {topNodes.map((node) => {
            const isProductowner = node.roleSlug === 'productowner'
            return (
              <div key={node.id} className="flex flex-col items-center" style={{ width: NODE_CARD_WIDTH }}>
                <AgentNodeCard
                  node={node}
                  onSetStatus={onSetStatus}
                  onRequestTrigger={onRequestTrigger}
                  onConfig={onConfig}
                  timelineHighlightAgentId={timelineHighlightAgentId}
                />
                {isProductowner && workerNodes.length > 0 ? (
                  <>
                    <TreeStem className="mt-2" />
                    {workerNodes.length > 1 ? <TreeFork centers={workerCenters} width={workerRowWidth} /> : <TreeStem />}
                    <div className="mt-0 flex shrink-0 items-start justify-center" style={{ width: workerRowWidth, gap: workerGap }}>
                      {workerNodes.map((workerNode) => (
                        <AgentNodeCard
                          key={workerNode.id}
                          node={workerNode}
                          onSetStatus={onSetStatus}
                          onRequestTrigger={onRequestTrigger}
                          onConfig={onConfig}
                          compact
                          timelineHighlightAgentId={timelineHighlightAgentId}
                        />
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default function AgentCanvasMermaid({
  token,
  pipelineId: _pipelineId = 1,
  onOpenControl,
  onOpenAssistantConfig,
  tenantName,
}: Props) {
  const navigate = useNavigate()
  const [timelineHighlightAgentId, setTimelineHighlightAgentId] = useState<string | null>(null)
  const [triggerModalOpen, setTriggerModalOpen] = useState(false)
  const [triggerTargetNode, setTriggerTargetNode] = useState<WorkforceNode | null>(null)
  const [triggerInstruction, setTriggerInstruction] = useState('')
  const {
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
  } = useWorkforceData(token)

  const { connectionState, realtimeDebug } = useWorkforceRealtime({
    organisationId: realtimeOrganisationId,
    token,
    onEvent: applyEvent,
    onRefresh: loadStatus,
  })

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  const handleConfigureNode = useCallback(
    (node: WorkforceNode) => {
      onOpenControl?.()
      void navigate(`/workforce?agentId=${encodeURIComponent(node.id)}&panel=control`)
    },
    [navigate, onOpenControl],
  )

  const handleRequestTrigger = useCallback((node: WorkforceNode) => {
    setTriggerTargetNode(node)
    setTriggerInstruction('')
    setTriggerModalOpen(true)
  }, [])

  const closeTriggerModal = useCallback(() => {
    setTriggerModalOpen(false)
    setTriggerTargetNode(null)
    setTriggerInstruction('')
  }, [])

  const submitTriggerModal = useCallback(async () => {
    if (!triggerTargetNode) return
    await setNodeStatus(triggerTargetNode, 'active', triggerInstruction)
    closeTriggerModal()
  }, [closeTriggerModal, setNodeStatus, triggerInstruction, triggerTargetNode])

  const workforceTitle = `${(tenantName && tenantName.trim()) || 'Tenant'} Workforce`

  return (
    <div className="h-full min-h-0">
      <div className="w-full h-full min-h-0">
        <Card className="relative overflow-visible border-border h-full min-h-0 rounded-none border-x-0 border-b-0">
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              backgroundColor: 'rgb(var(--color-bg-surface))',
              backgroundImage: 'radial-gradient(circle, rgba(var(--color-border),0.6) 0.9px, transparent 0)',
              backgroundSize: '16px 16px',
            }}
          />
          <CardContent className="h-full min-h-0 py-3 px-3 relative z-10">
            <div className="h-full min-h-0 flex flex-col gap-3">
              <WorkforceHeader
                workforceTitle={workforceTitle}
                connectionState={connectionState}
                realtimeDebug={realtimeDebug}
                isLoading={isLoading}
                isActioning={isActioning}
                managerNode={managerNode}
                onOpenAssistantConfig={onOpenAssistantConfig}
                onOpenControl={onOpenControl}
                onRefresh={() => void loadStatus()}
                onToggleManager={(status) => {
                  if (!managerNode) return
                  void setNodeStatus(managerNode, status)
                }}
              />

              <div className="flex-1 min-h-0 grid grid-cols-[260px_1fr_300px] grid-rows-[minmax(0,1fr)_140px] gap-4">
                <div className="min-h-0 flex flex-col">
                  <div className="min-h-0 flex-1 rounded-lg border border-border/70 bg-bg-elevated/65 p-3.5">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-[13px] font-bold text-text-heading">Feature Queue</h3>
                      <Badge variant="neutral">{viewState.features.length}</Badge>
                    </div>
                    <div className="h-[calc(100%-2rem)] overflow-y-auto pr-1">
                      <FeatureQueue features={viewState.features} />
                    </div>
                  </div>
                </div>

                <div className="h-full min-h-0 min-w-0">
                  <WorkforceTree
                    manager={nodesByRole.get('manager') ?? managerNode}
                    productowner={nodesByRole.get('productowner') ?? null}
                    legal={nodesByRole.get('legal') ?? null}
                    builder={nodesByRole.get('builder') ?? null}
                    tester={nodesByRole.get('tester') ?? null}
                    auditor={nodesByRole.get('auditor') ?? null}
                    onSetStatus={setNodeStatus}
                    onRequestTrigger={handleRequestTrigger}
                    onConfig={handleConfigureNode}
                    timelineHighlightAgentId={timelineHighlightAgentId}
                  />
                </div>

                <div className="min-h-0 rounded-lg border border-border/70 bg-bg-elevated/65 p-3.5 flex flex-col shadow-sm">
                  <div className="flex items-center justify-between gap-2 mb-2.5">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-text-heading">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                        <Activity size={15} strokeWidth={2.25} aria-hidden />
                      </span>
                      Activity History
                    </h3>
                    <Badge variant="info" className="shrink-0 tabular-nums">
                      {viewState.logs.length}
                    </Badge>
                  </div>
                  <div className="min-h-0 flex-1">
                    <SessionLog entries={viewState.logs} />
                  </div>
                </div>

                <div className="col-span-3 min-h-0 pt-0.5">
                  <WorkforceTimeline
                    activities={timeline}
                    labelByAgentId={labelByAgentId}
                    roleByAgentId={roleByAgentId}
                    onHighlightAgentChange={setTimelineHighlightAgentId}
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={triggerModalOpen}
        onOpenChange={(open) => {
          if (open) {
            setTriggerModalOpen(true)
            return
          }
          closeTriggerModal()
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Trigger agent</DialogTitle>
            <DialogDescription>
              {triggerTargetNode
                ? `Geef een specifieke instructie voor ${triggerTargetNode.label}. Laat leeg om de standaard rolinstructie te gebruiken.`
                : 'Geef een specifieke instructie voor deze agent.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor="agent-trigger-instruction" className="text-xs font-semibold text-text-secondary">
              Instructie
            </label>
            <Textarea
              id="agent-trigger-instruction"
              value={triggerInstruction}
              onChange={(event) => setTriggerInstruction(event.target.value)}
              placeholder="Bijv. Pak de volgende feature op en delegeer sequentieel naar builder, tester en auditor."
              className="min-h-[140px]"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={closeTriggerModal}>
              Annuleren
            </Button>
            <Button type="button" onClick={() => void submitTriggerModal()} disabled={!triggerTargetNode || isActioning}>
              Trigger
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {error && (
        <Card className="border-status-error/40">
          <CardContent className="pt-3 text-sm text-status-error">{error}</CardContent>
        </Card>
      )}
    </div>
  )
}
