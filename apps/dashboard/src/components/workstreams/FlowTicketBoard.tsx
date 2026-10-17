import { useEffect, useState, type ReactNode } from 'react'
import { DndContext, PointerSensor, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ChevronDown, FolderKanban, Plus, Settings } from 'lucide-react'
import { toast } from 'sonner'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { Skeleton } from '../ui/skeleton'
import {
  stageLabel,
  moveTicketToStage,
  type BoardTicket,
  type FlowBoard,
  type FlowBoardLane,
  type TicketStage,
} from '../../lib/tickets-api'
import { useCollectStageFields } from '../inbox/TicketStageGate'
import { cn } from '../../lib/utils'
import {
  allowedKindsAt,
  firstOutOfOrder,
  kindForInsert,
  moveKeepsOrder,
  waitingStageFill,
} from '../../lib/stage-order'
import { FlowTicketCard } from './FlowTicketCard'
import { StageEditorDialog } from './WorkstreamStagesCard'
import { StageProgressIcon } from './StageProgressIcon'

const CELL_PREFIX = 'flow-cell:'

/** Fixed phase columns. They stay narrow and scroll sideways when a flow has many stages. */
const PHASE_COLUMN = '14rem'

function gridStyle(stageCount: number) {
  return { gridTemplateColumns: `repeat(${stageCount}, ${PHASE_COLUMN})` }
}

/**
 * The flow's live tickets. Columns are the stages; rows are the projects the
 * flow is on (plus No project). Dragging moves a ticket between stages inside
 * its own lane; the project is changed on the conversation, not here.
 */
export function FlowTicketBoard({
  board,
  canMove,
  onChange,
  canEditStages = false,
  onSaveStages,
  editStageKey = null,
}: {
  board: FlowBoard
  canMove: boolean
  onChange: (board: FlowBoard) => void
  /** Admins rename, retune and add stages on the board itself. */
  canEditStages?: boolean
  onSaveStages?: (stages: TicketStage[]) => Promise<void> | void
  /** Open this stage's editor once (deep link from a ticket). */
  editStageKey?: string | null
}) {
  const { t } = useTranslation('nav')
  const collect = useCollectStageFields()
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [editorKey, setEditorKey] = useState<string | null>(null)
  const [savingStages, setSavingStages] = useState(false)
  const stageKeys = new Set(board.stages.map((s) => s.key))
  const firstKey = board.stages[0]?.key ?? ''
  const stageOf = (ticket: BoardTicket) => (stageKeys.has(ticket.stage_key) ? ticket.stage_key : firstKey)
  const showLanes = board.lanes.length > 1

  const move = async (ticket: BoardTicket, stageKey: string) => {
    if (stageOf(ticket) === stageKey) return
    const stage = board.stages.find((row) => row.key === stageKey)
    if (!stage) return
    const previous = board
    try {
      const result = await moveTicketToStage({
        signalId: ticket.signal_id,
        stage,
        values: ticket.fields,
        collect,
        ticketName: ticket.tag,
      })
      if (result.cancelled) return
      onChange({
        ...board,
        tickets: board.tickets.map((row) =>
          row.signal_id === ticket.signal_id ? { ...row, stage_key: stageKey, status: stage.kind } : row,
        ),
      })
    } catch (err) {
      onChange(previous)
      toast.error(formatApiErrorMessage(err, t('projects.home.ticketMoveError')))
    }
  }

  useEffect(() => {
    if (editStageKey) setEditorKey(editStageKey)
  }, [editStageKey])

  const saveStages = async (stages: TicketStage[]) => {
    if (!onSaveStages) return
    setSavingStages(true)
    try {
      await onSaveStages(stages)
    } finally {
      setSavingStages(false)
    }
  }

  const commitStages = (stages: TicketStage[]) => {
    if (!stages.length || !stages.some((stage) => stage.kind === 'done')) {
      toast.error(t('workstreamsPage.stages.needDone'))
      return
    }
    const broken = firstOutOfOrder(stages)
    if (broken >= 0) {
      const stage = stages[broken]
      toast.error(
        t('workstreamsPage.stages.kindOrderNamed', {
          name: stage?.name ?? '',
          kind: t(`workstreamsPage.stages.kinds.${stage?.kind ?? 'open'}`),
        }),
      )
      return
    }
    void saveStages(stages)
  }

  const insertStage = (index: number) => {
    const kind = kindForInsert(board.stages, index)
    const base = t(`workstreamsPage.stages.kinds.${kind}`)
    const taken = new Set(board.stages.map((stage) => stage.name.trim().toLowerCase()))
    let name = base
    let n = 2
    while (taken.has(name.toLowerCase())) {
      name = `${base} ${n}`
      n += 1
    }
    const next = [...board.stages]
    next.splice(index, 0, {
      key: '',
      name,
      kind,
      auto_close_conversation: false,
      fields: [],
      owner: null,
      checkup_minutes: 0,
    })
    commitStages(next)
  }

  const editing = board.stages.find((stage) => stage.key === editorKey) ?? null

  const toggleLane = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <div
      className="max-h-[calc(100vh-15rem)] overflow-auto rounded-xl border border-border/50 bg-bg-input/20"
      data-testid="flow-ticket-board"
    >
      <div className="min-w-max">
        <div className="group/stages sticky top-0 z-10 flex items-center border-b border-border/50 bg-bg-elevated/95 backdrop-blur">
          <div className="relative grid shrink-0 gap-2 px-2 py-2" style={gridStyle(board.stages.length)}>
            {board.stages.map((stage, index) => {
              const count = board.tickets.filter((ticket) => stageOf(ticket) === stage.key).length
              return (
                <StageColumnHeader
                  key={stage.key}
                  stage={stage}
                  count={count}
                  fill={waitingStageFill(board.stages, index)}
                  canEdit={canEditStages}
                  onEdit={() => setEditorKey(stage.key)}
                />
              )
            })}
            {canEditStages
              ? board.stages.slice(1).map((stage, offset) => {
                  const index = offset + 1
                  const kind = kindForInsert(board.stages, index)
                  return (
                    <button
                      key={`insert-${stage.key}`}
                      type="button"
                      disabled={savingStages}
                      aria-label={t('workstreamsPage.stages.insertBetween', {
                        kind: t(`workstreamsPage.stages.kinds.${kind}`),
                      })}
                      title={t('workstreamsPage.stages.insertBetween', {
                        kind: t(`workstreamsPage.stages.kinds.${kind}`),
                      })}
                      onClick={() => insertStage(index)}
                      style={{
                        left: `calc(0.5rem + ${index} * (${PHASE_COLUMN} + 0.5rem) - 0.25rem)`,
                      }}
                      className="absolute top-1/2 z-20 inline-flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border/80 bg-bg-elevated text-text-muted opacity-0 shadow-sm transition-opacity hover:border-border hover:text-text-heading focus-visible:opacity-100 group-hover/stages:opacity-100 disabled:opacity-40"
                    >
                      <Plus size={12} aria-hidden />
                    </button>
                  )
                })
              : null}
          </div>
          {canEditStages ? (
            <button
              type="button"
              disabled={savingStages}
              onClick={() => insertStage(board.stages.length)}
              className="mr-2 inline-flex h-7 shrink-0 items-center gap-1.5 self-center rounded-full border border-dashed border-border/80 px-3 text-xs font-medium text-text-muted transition-colors hover:border-border hover:bg-bg-hover hover:text-text-heading disabled:opacity-40"
            >
              <Plus size={13} aria-hidden />
              {t('workstreamsPage.stages.addButton')}
            </button>
          ) : null}
        </div>
        {board.lanes.map((lane) => {
          const laneKey = lane.id ?? 'none'
          const laneTickets = board.tickets.filter((ticket) => (ticket.project_id ?? null) === lane.id)
          const isCollapsed = collapsed.has(laneKey)
          return (
            <section key={laneKey} className={cn(showLanes && 'border-b border-border/40 last:border-b-0')}>
              {showLanes ? (
                <LaneHeader
                  lane={lane}
                  count={laneTickets.length}
                  collapsed={isCollapsed}
                  onToggle={() => toggleLane(laneKey)}
                />
              ) : null}
              {isCollapsed ? null : (
                <LaneRow
                  laneKey={laneKey}
                  stageCount={board.stages.length}
                  onDrop={(ticketId, stageKey) => {
                    const ticket = laneTickets.find((row) => row.signal_id === ticketId)
                    if (ticket) void move(ticket, stageKey)
                  }}
                >
                  {board.stages.map((stage) => {
                    const cell = laneTickets.filter((ticket) => stageOf(ticket) === stage.key)
                    return (
                      <StageCell key={stage.key} id={`${CELL_PREFIX}${laneKey}:${stage.key}`}>
                        {cell.map((ticket) => (
                          <FlowTicketCard key={ticket.signal_id} ticket={ticket} disabled={!canMove} />
                        ))}
                      </StageCell>
                    )
                  })}
                </LaneRow>
              )}
            </section>
          )
        })}
      </div>
      {canEditStages ? (
        <StageEditorDialog
          stage={editing}
          open={Boolean(editing)}
          saving={savingStages}
          canRemove={board.stages.length > 1}
          kinds={
            editing
              ? allowedKindsAt(
                  board.stages,
                  board.stages.findIndex((stage) => stage.key === editing.key),
                )
              : undefined
          }
          canMoveLeft={moveKeepsOrder(
            board.stages,
            board.stages.findIndex((stage) => stage.key === editorKey),
            -1,
          )}
          canMoveRight={moveKeepsOrder(
            board.stages,
            board.stages.findIndex((stage) => stage.key === editorKey),
            1,
          )}
          onMove={(direction) => {
            const index = board.stages.findIndex((stage) => stage.key === editorKey)
            const next = [...board.stages]
            const target = index + direction
            const [row] = next.splice(index, 1)
            if (!row || target < 0 || target > next.length) return
            next.splice(target, 0, row)
            commitStages(next)
          }}
          onOpenChange={(open) => {
            if (!open) setEditorKey(null)
          }}
          onSave={(next) => {
            commitStages(board.stages.map((row) => (row.key === next.key ? next : row)))
            setEditorKey(null)
          }}
          onRemove={() => {
            commitStages(board.stages.filter((row) => row.key !== editing?.key))
            setEditorKey(null)
          }}
        />
      ) : null}
    </div>
  )
}

function StageColumnHeader({
  stage,
  count,
  fill,
  canEdit,
  onEdit,
}: {
  stage: TicketStage
  count: number
  fill?: number
  canEdit: boolean
  onEdit: () => void
}) {
  const { t } = useTranslation('nav')
  const shown = stageLabel(stage, t)
  return (
    <div className="group/col flex min-w-0 items-center gap-1.5 px-1">
      <StageProgressIcon kind={stage.kind} fill={fill} size={15} />
      <span className="truncate text-xs font-semibold text-text-heading">{shown}</span>
      {canEdit ? (
        <button
          type="button"
          onClick={onEdit}
          aria-label={t('workstreamsPage.stages.editTitle')}
          title={t('workstreamsPage.stages.editTitle')}
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-muted opacity-0 transition-opacity hover:bg-bg-hover hover:text-text-heading focus-visible:opacity-100 group-hover/col:opacity-100"
        >
          <Settings size={13} aria-hidden />
        </button>
      ) : null}
      <span className="ml-auto text-2xs tabular-nums text-text-muted">{count}</span>
    </div>
  )
}

function LaneHeader({
  lane,
  count,
  collapsed,
  onToggle,
}: {
  lane: FlowBoardLane
  count: number
  collapsed: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation('nav')
  const label = lane.id ? lane.name : t('workstreamsPage.board.noProject')
  return (
    <div className="flex items-center gap-2 px-3 pt-2.5 text-xs">
      <button
        type="button"
        onClick={onToggle}
        className="inline-flex items-center gap-1.5 rounded px-1 py-0.5 font-medium text-text-secondary transition-colors hover:bg-bg-muted/60 hover:text-text-heading"
        aria-expanded={!collapsed}
      >
        <ChevronDown size={13} className={cn('transition-transform', collapsed && '-rotate-90')} aria-hidden />
        <FolderKanban size={13} className="text-text-muted" aria-hidden />
        <span className={cn(!lane.id && 'italic text-text-muted')}>{label}</span>
      </button>
      <span className="text-2xs tabular-nums text-text-muted">{count}</span>
      {lane.id ? (
        <Link
          to={`/folders/${encodeURIComponent(lane.id)}`}
          className="ml-auto text-2xs text-text-muted hover:text-accent"
        >
          {t('workstreamsPage.board.openProject')}
        </Link>
      ) : null}
    </div>
  )
}

function LaneRow({
  laneKey,
  stageCount,
  onDrop,
  children,
}: {
  laneKey: string
  stageCount: number
  onDrop: (ticketId: string, stageKey: string) => void
  children: ReactNode
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))
  const prefix = `${CELL_PREFIX}${laneKey}:`
  const onDragEnd = (event: DragEndEvent) => {
    const overId = event.over?.id ? String(event.over.id) : ''
    if (!overId.startsWith(prefix)) return
    onDrop(String(event.active.id), overId.slice(prefix.length))
  }
  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="grid gap-2 p-2" style={gridStyle(stageCount)}>
        {children}
      </div>
    </DndContext>
  )
}

function StageCell({ id, children }: { id: string; children: ReactNode[] }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  const empty = children.length === 0
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex min-h-[5.5rem] flex-col gap-1.5 rounded-lg p-1 transition-colors',
        empty && 'border border-dashed border-border/40',
        isOver && 'bg-accent/5 ring-1 ring-accent/50',
      )}
    >
      {children}
    </div>
  )
}

export function FlowTicketBoardSkeleton({ columns = 3 }: { columns?: number }) {
  return (
    <div className="rounded-xl border border-border/50 p-2" aria-busy>
      <div className="grid gap-2" style={gridStyle(columns)}>
        {Array.from({ length: columns }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16 opacity-70" />
          </div>
        ))}
      </div>
    </div>
  )
}
