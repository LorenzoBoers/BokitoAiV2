import { useState, type ReactNode } from 'react'
import { DndContext, PointerSensor, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ChevronDown, FolderKanban } from 'lucide-react'
import { toast } from 'sonner'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { Skeleton } from '../ui/skeleton'
import { patchTicket, stageLabel, type BoardTicket, type FlowBoard, type FlowBoardLane } from '../../lib/tickets-api'
import { cn } from '../../lib/utils'
import { FlowTicketCard } from './FlowTicketCard'
import { StageProgressIcon } from './StageProgressIcon'

const CELL_PREFIX = 'flow-cell:'

/** Column width shared by the sticky header and every lane row. */
function gridStyle(stageCount: number) {
  return { gridTemplateColumns: `repeat(${stageCount}, minmax(13rem, 1fr))` }
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
}: {
  board: FlowBoard
  canMove: boolean
  onChange: (board: FlowBoard) => void
}) {
  const { t } = useTranslation('nav')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const stageKeys = new Set(board.stages.map((s) => s.key))
  const firstKey = board.stages[0]?.key ?? ''
  const stageOf = (ticket: BoardTicket) => (stageKeys.has(ticket.stage_key) ? ticket.stage_key : firstKey)
  const showLanes = board.lanes.length > 1

  const move = async (ticket: BoardTicket, stageKey: string) => {
    if (stageOf(ticket) === stageKey) return
    const stage = board.stages.find((row) => row.key === stageKey)
    if (!stage) return
    const previous = board
    onChange({
      ...board,
      tickets: board.tickets.map((row) =>
        row.signal_id === ticket.signal_id ? { ...row, stage_key: stageKey, status: stage.kind } : row,
      ),
    })
    try {
      await patchTicket(ticket.signal_id, { stage_key: stageKey })
    } catch (err) {
      onChange(previous)
      toast.error(formatApiErrorMessage(err, t('projects.home.ticketMoveError')))
    }
  }

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
        <div
          className="sticky top-0 z-10 grid gap-2 border-b border-border/50 bg-bg-elevated/95 px-2 py-2 backdrop-blur"
          style={gridStyle(board.stages.length)}
        >
          {board.stages.map((stage) => {
            const count = board.tickets.filter((ticket) => stageOf(ticket) === stage.key).length
            return (
              <div key={stage.key} className="flex items-center gap-1.5 px-1">
                <StageProgressIcon kind={stage.kind} size={15} />
                <span className="truncate text-xs font-semibold text-text-heading">{stageLabel(stage, t)}</span>
                <span className="ml-auto text-2xs tabular-nums text-text-muted">{count}</span>
              </div>
            )
          })}
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
          to={`/projects/${encodeURIComponent(lane.id)}`}
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
