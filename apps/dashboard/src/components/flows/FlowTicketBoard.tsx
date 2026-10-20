import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { DndContext, PointerSensor, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ChevronDown, FolderKanban, ListFilter, Pencil, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { ENTITY_ICONS } from '../../lib/entity-icons'
import { tagPath } from '../../lib/messages-paths'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { Button } from '../ui/button'
import { EmptyState } from '../ui/empty-state'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Skeleton } from '../ui/skeleton'
import { insertFlowStage } from '../../lib/flows-api'
import {
  stageLabel,
  moveTicketToStage,
  type BoardTicket,
  type FlowBoard,
  type FlowBoardLane,
  type TicketStage,
  type TicketStageField,
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

const FILTER_ANY = '__any__'

/** Field defs across stages (first definition wins), same idea as the API. */
function boardFieldDefs(stages: TicketStage[]): TicketStageField[] {
  const seen = new Set<string>()
  const out: TicketStageField[] = []
  for (const stage of stages) {
    for (const field of stage.fields ?? []) {
      if (!field.key || seen.has(field.key)) continue
      seen.add(field.key)
      out.push(field)
    }
  }
  return out
}

function ticketMatchesFieldFilters(
  ticket: BoardTicket,
  defs: TicketStageField[],
  filters: Record<string, string>,
): boolean {
  for (const field of defs) {
    const want = (filters[field.key] ?? '').trim()
    if (!want) continue
    const got = String(ticket.fields?.[field.key] ?? '').trim()
    if (field.type === 'enum') {
      if (got !== want) return false
      continue
    }
    if (field.type === 'number') {
      const wantN = Number(want.replace(',', '.'))
      const gotN = Number(got.replace(',', '.'))
      if (Number.isFinite(wantN) && Number.isFinite(gotN)) {
        if (gotN !== wantN) return false
      } else if (got.toLowerCase() !== want.toLowerCase()) {
        return false
      }
      continue
    }
    if (!got.toLowerCase().includes(want.toLowerCase())) return false
  }
  return true
}

const ConversationIcon = ENTITY_ICONS.conversation

const CELL_PREFIX = 'flow-cell:'

/** Default / clamp for stage columns (px). Boards scroll sideways when many stages. */
const COL_DEFAULT = 224
const COL_MIN = 160
const COL_MAX = 400
/** Matches Tailwind `gap-2` / `px-2` on the stage grid. */
const COL_GAP = 8
const COL_PAD = 8
/** Hit target width (`w-2.5`); line is centered so neighbors share the gap midpoint. */
const COL_EDGE_HIT = 10
const COL_EDGE_OFFSET = COL_GAP / 2 + COL_EDGE_HIT / 2

function clampColWidth(px: number) {
  return Math.min(COL_MAX, Math.max(COL_MIN, Math.round(px)))
}

function gridStyle(widths: number[]) {
  return { gridTemplateColumns: widths.map((w) => `${w}px`).join(' ') }
}

function columnBoundaryLeft(widths: number[], index: number) {
  let left = COL_PAD
  for (let i = 0; i < index; i += 1) {
    left += (widths[i] ?? COL_DEFAULT) + COL_GAP
  }
  return left
}

/**
 * The flow's live tickets. Columns are stages; rows are folders that share the
 * flow's action tag (plus No project). Empty candidate lanes stay hidden unless
 * ``showEmptyLanes`` is on. Dragging moves a ticket between stages inside its
 * own lane; the project is changed on the conversation, not here.
 */
export function FlowTicketBoard({
  board,
  canMove,
  onChange,
  canEditStages = false,
  onSaveStages,
  editStageKey = null,
  showEmptyLanes = false,
  actionTag = '',
}: {
  board: FlowBoard
  canMove: boolean
  onChange: (board: FlowBoard) => void
  /** Admins rename, retune and add stages on the board itself. */
  canEditStages?: boolean
  onSaveStages?: (stages: TicketStage[]) => Promise<void> | void
  /** Open this stage's editor once (deep link from a ticket). */
  editStageKey?: string | null
  /** When false (default), hide lanes that have no tickets. */
  showEmptyLanes?: boolean
  /** Flow action-tag name for the empty-board CTA (without #). */
  actionTag?: string
}) {
  const { t } = useTranslation('nav')
  const collect = useCollectStageFields()
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [editorKey, setEditorKey] = useState<string | null>(null)
  const [savingStages, setSavingStages] = useState(false)
  const [colWidths, setColWidths] = useState<number[]>(() => board.stages.map(() => COL_DEFAULT))
  const [fieldFilters, setFieldFilters] = useState<Record<string, string>>({})
  const stageKeys = new Set(board.stages.map((s) => s.key))
  const firstKey = board.stages[0]?.key ?? ''
  const stageOf = (ticket: BoardTicket) => (stageKeys.has(ticket.stage_key) ? ticket.stage_key : firstKey)
  const fieldDefs = useMemo(() => boardFieldDefs(board.stages), [board.stages])
  const filtersActive = fieldDefs.some((field) => Boolean((fieldFilters[field.key] ?? '').trim()))
  const visibleTickets = useMemo(
    () =>
      filtersActive
        ? board.tickets.filter((ticket) => ticketMatchesFieldFilters(ticket, fieldDefs, fieldFilters))
        : board.tickets,
    [board.tickets, fieldDefs, fieldFilters, filtersActive],
  )
  const visibleLanes = board.lanes.filter((lane) => {
    if (showEmptyLanes) return true
    return visibleTickets.some((ticket) => (ticket.project_id ?? null) === lane.id)
  })
  const showLanes = visibleLanes.length > 1
  const widths = board.stages.map((_, i) => colWidths[i] ?? COL_DEFAULT)
  const boardMinWidth = columnBoundaryLeft(widths, widths.length) - COL_GAP + COL_PAD

  const setFieldFilter = (key: string, value: string) => {
    setFieldFilters((prev) => {
      const next = { ...prev }
      if (!value.trim()) delete next[key]
      else next[key] = value
      return next
    })
  }

  const clearFieldFilters = () => setFieldFilters({})

  useEffect(() => {
    setColWidths((prev) => {
      if (prev.length === board.stages.length) return prev
      return board.stages.map((_, i) => prev[i] ?? COL_DEFAULT)
    })
  }, [board.stages.length])

  const setColWidthAt = (index: number, next: number) => {
    setColWidths((prev) => {
      const base = board.stages.map((_, i) => prev[i] ?? COL_DEFAULT)
      base[index] = clampColWidth(next)
      return base
    })
  }

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
    void (async () => {
      setSavingStages(true)
      try {
        const updated = await insertFlowStage(board.workstream_id, { kind, index })
        onChange({ ...board, stages: updated.stages })
      } catch (err) {
        toast.error(formatApiErrorMessage(err, t('workstreamsPage.stages.needDone')))
      } finally {
        setSavingStages(false)
      }
    })()
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
      className="rounded-xl border border-border/50 bg-bg-input/20"
      data-testid="flow-ticket-board"
    >
      {fieldDefs.length > 0 ? (
        <BoardFieldFilters
          fields={fieldDefs}
          filters={fieldFilters}
          shown={visibleTickets.length}
          total={board.tickets.length}
          onChange={setFieldFilter}
          onClear={clearFieldFilters}
        />
      ) : null}
      <div className="max-h-[calc(100vh-15rem)] overflow-auto">
        <div className="min-w-max">
          <div className="group/stages sticky top-0 z-10 flex items-center border-b border-border/50 bg-bg-elevated/95 backdrop-blur">
            <div className="relative grid shrink-0 gap-2 px-2 py-2" style={gridStyle(widths)}>
              {board.stages.map((stage, index) => {
                const count = visibleTickets.filter((ticket) => stageOf(ticket) === stage.key).length
                return (
                  <StageColumnHeader
                    key={stage.key}
                    stage={stage}
                    count={count}
                    fill={waitingStageFill(board.stages, index)}
                    canEdit={canEditStages}
                    onEdit={() => setEditorKey(stage.key)}
                    width={widths[index] ?? COL_DEFAULT}
                    onResize={(next) => setColWidthAt(index, next)}
                    showLeftEdge={index > 0}
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
                          // Further left of the column boundary so it clears both
                          // resize dividers on the hovered column.
                          left: columnBoundaryLeft(widths, index) - 28,
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
          {board.tickets.length === 0 ? (
            <div className="px-3 py-4" style={{ minWidth: boardMinWidth }}>
              <EmptyState
                tone="dashed"
                size="sm"
                icon={ConversationIcon}
                title={t('workstreamsPage.board.emptyTitle')}
                description={
                  actionTag
                    ? t('workstreamsPage.board.emptyBody', { tag: actionTag.replace(/^#/, '') })
                    : t('workstreamsPage.board.emptyBodyPlain')
                }
                action={
                  <Button asChild size="sm" variant="secondary">
                    <Link to={actionTag ? tagPath(actionTag.replace(/^#/, '')) : '/communication'}>
                      {t('workstreamsPage.board.emptyAction')}
                    </Link>
                  </Button>
                }
              />
            </div>
          ) : visibleTickets.length === 0 ? (
            <div className="px-3 py-4" style={{ minWidth: boardMinWidth }}>
              <EmptyState
                tone="dashed"
                size="sm"
                icon={ListFilter}
                title={t('workstreamsPage.board.filterEmptyTitle')}
                description={t('workstreamsPage.board.filterEmptyBody')}
                action={
                  <Button type="button" size="sm" variant="secondary" onClick={clearFieldFilters}>
                    {t('workstreamsPage.board.filterClear')}
                  </Button>
                }
              />
            </div>
          ) : (
            visibleLanes.map((lane) => {
              const laneKey = lane.id ?? 'none'
              const laneTickets = visibleTickets.filter((ticket) => (ticket.project_id ?? null) === lane.id)
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
                      columnWidths={widths}
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
            })
          )}
        </div>
      </div>
      {canEditStages ? (
        <StageEditorDialog
          stage={editing}
          open={Boolean(editing)}
          saving={savingStages}
          canRemove={board.stages.length > 1 && editing?.kind !== 'open'}
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

function BoardFieldFilters({
  fields,
  filters,
  shown,
  total,
  onChange,
  onClear,
}: {
  fields: TicketStageField[]
  filters: Record<string, string>
  shown: number
  total: number
  onChange: (key: string, value: string) => void
  onClear: () => void
}) {
  const { t } = useTranslation('nav')
  const active = fields.some((field) => Boolean((filters[field.key] ?? '').trim()))
  return (
    <div
      className="flex flex-wrap items-center gap-2 border-b border-border/50 bg-bg-elevated/80 px-2.5 py-2"
      data-testid="flow-board-field-filters"
    >
      <span className="inline-flex items-center gap-1 text-2xs font-medium text-text-muted">
        <ListFilter size={12} aria-hidden />
        {t('workstreamsPage.board.filterLabel')}
      </span>
      {fields.map((field) => {
        const value = filters[field.key] ?? ''
        if (field.type === 'enum') {
          return (
            <label key={field.key} className="inline-flex items-center gap-1.5">
              <span className="sr-only">{field.name}</span>
              <Select
                value={value || FILTER_ANY}
                onValueChange={(next) => onChange(field.key, next === FILTER_ANY ? '' : next)}
              >
                <SelectTrigger className="h-7 w-[9.5rem] text-xs" aria-label={field.name}>
                  <SelectValue placeholder={field.name} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={FILTER_ANY}>{t('workstreamsPage.board.filterAny', { name: field.name })}</SelectItem>
                  {(field.options ?? []).map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          )
        }
        return (
          <label key={field.key} className="inline-flex min-w-0 items-center">
            <span className="sr-only">{field.name}</span>
            <Input
              type={field.type === 'number' ? 'text' : 'search'}
              inputMode={field.type === 'number' ? 'decimal' : undefined}
              value={value}
              onChange={(event) => onChange(field.key, event.target.value)}
              placeholder={field.name}
              aria-label={field.name}
              className="h-7 w-[9.5rem] px-2 text-xs"
            />
          </label>
        )
      })}
      {active ? (
        <>
          <span className="text-2xs tabular-nums text-text-muted">
            {t('workstreamsPage.board.filterShowing', { shown, total })}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs text-text-muted"
            onClick={onClear}
          >
            <X size={12} aria-hidden />
            {t('workstreamsPage.board.filterClear')}
          </Button>
        </>
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
  width,
  onResize,
  showLeftEdge,
}: {
  stage: TicketStage
  count: number
  fill?: number
  canEdit: boolean
  onEdit: () => void
  width: number
  onResize: (next: number) => void
  /** False for the first column — no divider on the outer left. */
  showLeftEdge: boolean
}) {
  const { t } = useTranslation('nav')
  const shown = stageLabel(stage, t)
  return (
    <div className="group/col relative flex min-w-0 items-center gap-1.5 px-1">
      <StageProgressIcon kind={stage.kind} fill={fill} size={15} />
      <span className="truncate text-xs font-semibold text-text-heading">{shown}</span>
      <span className="shrink-0 text-2xs tabular-nums text-text-muted">{count}</span>
      {canEdit ? (
        <button
          type="button"
          onClick={onEdit}
          aria-label={t('workstreamsPage.stages.editTitle')}
          title={t('workstreamsPage.stages.editTitle')}
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-muted opacity-0 transition-opacity hover:bg-bg-hover hover:text-text-heading focus-visible:opacity-100 group-hover/col:opacity-100"
        >
          <Pencil size={13} aria-hidden />
        </button>
      ) : null}
      {showLeftEdge ? <ColumnBoundaryMark side="left" /> : null}
      <ColumnResizeHandle
        label={t('workstreamsPage.board.resizeColumn', { name: shown })}
        width={width}
        onResize={onResize}
      />
    </div>
  )
}

/**
 * Shared column-boundary mark. Left of col N+1 and right of col N both sit on
 * the gap midpoint so they read as one divider.
 */
function ColumnBoundaryMark({ side }: { side: 'left' | 'right' }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute top-1/2 z-20 h-6 w-2.5 -translate-y-1/2"
      style={side === 'left' ? { left: -COL_EDGE_OFFSET } : { right: -COL_EDGE_OFFSET }}
    >
      <div
        className={cn(
          'absolute inset-y-0 left-1/2 w-px -translate-x-1/2 rounded-full bg-border transition-[width,opacity]',
          'opacity-0 group-hover/col:opacity-100 group-hover/col:w-0.5',
        )}
      />
    </div>
  )
}

function ColumnResizeHandle({
  label,
  width,
  onResize,
}: {
  label: string
  width: number
  onResize: (next: number) => void
}) {
  const dragging = useRef(false)
  const startX = useRef(0)
  const startW = useRef(width)
  const [active, setActive] = useState(false)

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    dragging.current = true
    setActive(true)
    startX.current = event.clientX
    startW.current = width
    event.currentTarget.setPointerCapture(event.pointerId)
    document.body.classList.add('select-none')
    document.body.style.cursor = 'col-resize'
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    onResize(startW.current + (event.clientX - startX.current))
  }

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    dragging.current = false
    setActive(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    document.body.classList.remove('select-none')
    document.body.style.cursor = ''
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={COL_MIN}
      aria-valuemax={COL_MAX}
      aria-valuenow={width}
      title={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className="absolute top-1/2 z-30 h-6 w-2.5 -translate-y-1/2 cursor-col-resize touch-none"
      style={{ right: -COL_EDGE_OFFSET }}
    >
      {active ? <div className="fixed inset-0 z-[80] cursor-col-resize" /> : null}
      <div
        className={cn(
          'pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 rounded-full bg-border transition-[width,opacity]',
          'opacity-0 group-hover/col:opacity-100 group-hover/col:w-0.5',
          active && 'opacity-100 w-0.5 bg-border',
        )}
      />
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
  columnWidths,
  onDrop,
  children,
}: {
  laneKey: string
  columnWidths: number[]
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
      <div className="grid gap-2 p-2" style={gridStyle(columnWidths)}>
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
  const widths = Array.from({ length: columns }, () => COL_DEFAULT)
  return (
    <div className="rounded-xl border border-border/50 p-2" aria-busy>
      <div className="grid gap-2" style={gridStyle(widths)}>
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
