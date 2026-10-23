import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeftRight,
  ArrowRight,
  Circle,
  Clock,
  FileText,
  Gauge,
  LayoutGrid,
  ListChecks,
  Loader2,
  Plus,
  Settings2,
  Square,
  Trash2,
  Users,
  Wrench,
} from 'lucide-react'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { DotGridBackground } from '../ui/DotGridBackground'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { SegmentedControl } from '../ui/segmented-control'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Textarea } from '../ui/textarea'
import { cn } from '../../lib/utils'
import {
  parseFlowSchema,
  patchWorkstream,
  renderFlowSchema,
  type FlowSchemaEdge,
  type FlowSchemaGraph,
  type FlowSchemaNode,
  type WorkstreamRow,
} from '../../lib/flows-api'
import { waitingStageFill } from '../../lib/stage-order'
import { stageLabel, type TicketStage } from '../../lib/tickets-api'
import { StageProgressIcon } from './StageProgressIcon'

const CARD_W = 212
const CARD_H = 84
const GAP_X = 132
const GAP_Y = 44
const BOX_PAD = 24
const LOOP_DROP = 96
const VIEW_PAD = 56
const NONE = '__none__'
const STOP = 'stop'
const MAX_RE = /^\d+\s*(m|u|d|werkdagen)$/
const WIE_VALUES = ['agent', 'user', 'beide'] as const
const STAND_VALUES = ['manual', 'assisted', 'autonomous'] as const

type Point = { x: number; y: number }
type Selection = { kind: 'node'; name: string } | { kind: 'edge'; index: number } | null
type Mode = 'diagram' | 'source'

function blankNode(name: string, text = ''): FlowSchemaNode {
  return {
    name,
    text,
    wie: '',
    tools: '',
    geeft: '',
    krijgt: '',
    faalt: '',
    stil: '',
    max: '',
    stand: '',
    plek: '',
  }
}

function blankEdge(src: string, dst: string): FlowSchemaEdge {
  return { src, dst, when: '', geeft: '', faalt: '', stil: '' }
}

/** The columns of this flow, in order, with a line between each pair. */
function chainOf(stages: TicketStage[], graph: Pick<FlowSchemaGraph, 'nodes' | 'edges'>) {
  const stored = graph.nodes ?? []
  const nodes: FlowSchemaNode[] = stages
    .filter((stage) => stage.key)
    .map((stage) => {
      const found = stored.find((node) => node.name === stage.key)
      return { ...blankNode(stage.key, stage.name), ...found, name: stage.key, text: found?.text || stage.name }
    })
  const edges: FlowSchemaEdge[] = []
  for (let index = 0; index < nodes.length - 1; index += 1) {
    const src = nodes[index].name
    const dst = nodes[index + 1].name
    const saved = (graph.edges ?? []).find((edge) => edge.src === src && edge.dst === dst)
    edges.push({ ...blankEdge(src, dst), ...saved, src, dst })
  }
  for (const edge of graph.edges ?? []) {
    if (!edge.src || !edge.dst) continue
    if (edges.some((have) => have.src === edge.src && have.dst === edge.dst && have.when === (edge.when || ''))) continue
    edges.push({ ...blankEdge(edge.src, edge.dst), ...edge })
  }
  const used = new Set(edges.flatMap((edge) => [edge.src, edge.dst]))
  for (const node of stored) {
    if (!node.name || node.name === STOP || nodes.some((have) => have.name === node.name)) continue
    if (!node.text && !used.has(node.name)) continue
    nodes.push({ ...blankNode(node.name), ...node })
  }
  return { nodes, edges }
}

function layout(nodes: FlowSchemaNode[], edges: FlowSchemaEdge[], order: string[]) {
  const names = nodes.map((node) => node.name)
  const linked = new Set(edges.flatMap((edge) => [edge.src, edge.dst]))
  const depth = new Map<string, number>()
  const seeds = order.filter((name) => names.includes(name))
  const start = seeds[0] ?? names.find((name) => linked.has(name) && !edges.some((edge) => edge.dst === name)) ?? names[0]
  const queue: Array<[string, number]> = start ? [[start, 0]] : []
  while (queue.length) {
    const next = queue.shift()
    if (!next) break
    const [name, level] = next
    if (depth.has(name)) continue
    depth.set(name, level)
    for (const edge of edges) {
      if (edge.src === name && edge.dst !== name && !depth.has(edge.dst)) queue.push([edge.dst, level + 1])
    }
  }
  const cells = new Map<string, Cell>()
  const taken = new Set<string>()
  const claim = (name: string, cell: Cell) => {
    cells.set(name, cell)
    taken.add(cellKey(cell))
  }
  for (const node of nodes) {
    const pinned = parsePlek(node.plek)
    if (pinned && node.name !== STOP && !taken.has(cellKey(pinned))) claim(node.name, pinned)
  }
  const pinnedCols = [...cells.values()].map((cell) => cell.col)
  let max = Math.max(0, ...pinnedCols)
  for (const level of depth.values()) max = Math.max(max, level)
  const loose = names.filter((name) => !depth.has(name) && !cells.has(name))
  if (loose.length) {
    max += 1
    loose.forEach((name) => depth.set(name, max))
  }
  if (names.includes(STOP)) {
    const others = names
      .filter((name) => name !== STOP)
      .map((name) => cells.get(name)?.col ?? depth.get(name) ?? 0)
    depth.set(STOP, Math.max(depth.get(STOP) ?? 0, Math.max(0, ...others) + 1))
  }
  const ordered = [...order.filter((name) => names.includes(name)), ...names.filter((name) => !order.includes(name))]
  for (const name of ordered) {
    if (cells.has(name)) continue
    claim(name, freeCell({ col: depth.get(name) ?? 0, row: 0 }, taken))
  }
  const all = [...cells.values()]
  const minCol = Math.min(...all.map((cell) => cell.col))
  const maxCol = Math.max(...all.map((cell) => cell.col))
  const minRow = Math.min(...all.map((cell) => cell.row))
  const maxRow = Math.max(...all.map((cell) => cell.row))
  const pos = new Map<string, Point>()
  for (const [name, cell] of cells) pos.set(name, cellPoint(cell, { minCol, minRow }))
  const loops = edges.some((edge) => {
    const from = cells.get(edge.src)
    const to = cells.get(edge.dst)
    return from && to && to.col < from.col
  })
  const cols = maxCol - minCol + 1
  const rows = maxRow - minRow + 1
  return {
    pos,
    cells,
    origin: { minCol, minRow },
    width: cols * CARD_W + (cols - 1) * GAP_X + BOX_PAD * 2,
    height: rows * CARD_H + (rows - 1) * GAP_Y + BOX_PAD * 2 + (loops ? LOOP_DROP : 0),
  }
}

type Cell = { col: number; row: number }
type Origin = { minCol: number; minRow: number }

function cellKey(cell: Cell) {
  return `${cell.col},${cell.row}`
}

function parsePlek(plek: string | undefined): Cell | null {
  const match = /^(-?\d+)\s*,\s*(-?\d+)$/.exec((plek ?? '').trim())
  return match ? { col: Number(match[1]), row: Number(match[2]) } : null
}

function cellStyle(at: Point) {
  return { left: at.x, top: at.y, width: CARD_W, height: CARD_H }
}

function cellPoint(cell: Cell, origin: Origin): Point {
  return {
    x: BOX_PAD + (cell.col - origin.minCol) * (CARD_W + GAP_X),
    y: BOX_PAD + (cell.row - origin.minRow) * (CARD_H + GAP_Y),
  }
}

/** The cell under a point on the stage (the point is a card's top-left corner when `corner` is set). */
function cellAt(point: Point, origin: Origin, corner = false): Cell {
  const x = corner ? point.x : point.x - CARD_W / 2
  const y = corner ? point.y : point.y - CARD_H / 2
  return {
    col: Math.round((x - BOX_PAD) / (CARD_W + GAP_X)) + origin.minCol,
    row: Math.round((y - BOX_PAD) / (CARD_H + GAP_Y)) + origin.minRow,
  }
}

/** The wanted cell, or the nearest free row in that column: below first, then above. */
function freeCell(want: Cell, taken: Set<string>): Cell {
  for (let step = 0; step < 64; step += 1) {
    const offset = step === 0 ? 0 : step % 2 === 1 ? (step + 1) / 2 : -step / 2
    const cell = { col: want.col, row: want.row + offset }
    if (!taken.has(cellKey(cell))) return cell
  }
  return want
}

function laneOf(edges: FlowSchemaEdge[], index: number) {
  const edge = edges[index]
  if (!edge) return 0
  const twins = edges
    .map((item, itemIndex) => ({ item, itemIndex }))
    .filter(({ item }) => item.src === edge.src && item.dst === edge.dst)
  const at = twins.findIndex(({ itemIndex }) => itemIndex === index)
  return (at - (twins.length - 1) / 2) * 18
}

function curve(from: Point, to: Point, lane: number) {
  if (to.x === from.x && to.y !== from.y) {
    const down = to.y > from.y
    const x1 = from.x + CARD_W / 2 + lane
    const y1 = down ? from.y + CARD_H : from.y
    const x2 = to.x + CARD_W / 2 + lane
    const y2 = down ? to.y : to.y + CARD_H
    return {
      d: `M ${x1} ${y1} L ${x2} ${y2}`,
      label: { x: x1, y: (y1 + y2) / 2 },
    }
  }
  if (to.x < from.x || to.x === from.x) {
    const x1 = from.x + CARD_W / 2
    const y1 = from.y + CARD_H
    const x2 = to.x + CARD_W / 2
    const y2 = to.y + CARD_H
    const drop = Math.max(y1, y2) + LOOP_DROP * 0.7 + lane
    return {
      d: `M ${x1} ${y1} C ${x1} ${drop}, ${x2} ${drop}, ${x2} ${y2}`,
      label: { x: (x1 + x2) / 2, y: drop - LOOP_DROP * 0.18 },
    }
  }
  const x1 = from.x + CARD_W
  const y1 = from.y + CARD_H / 2 + lane
  const x2 = to.x
  const y2 = to.y + CARD_H / 2 + lane
  const mid = (x1 + x2) / 2
  return {
    d: `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`,
    label: { x: mid, y: (y1 + y2) / 2 },
  }
}

function graphKey(nodes: FlowSchemaNode[], edges: FlowSchemaEdge[]) {
  return JSON.stringify({ nodes, edges })
}

function toolList(tools: string) {
  return tools
    .split(/[,\n]/)
    .map((tool) => tool.trim())
    .filter(Boolean)
}

export function FlowSchemaEditor({
  workstreamId,
  stages,
  initial,
  counts,
  onSaved,
  onClose,
}: {
  workstreamId: string
  stages: TicketStage[]
  initial: FlowSchemaGraph
  /** Live tickets per stage key, from the board. */
  counts?: Record<string, number>
  onSaved: (row: WorkstreamRow) => void
  onClose: () => void
}) {
  const { t } = useTranslation('nav')
  const seeded = useMemo(() => chainOf(stages, initial), [stages, initial])
  const [nodes, setNodes] = useState<FlowSchemaNode[]>(seeded.nodes)
  const [edges, setEdges] = useState<FlowSchemaEdge[]>(seeded.edges)
  const [selected, setSelected] = useState<Selection>(null)
  const [drag, setDrag] = useState<{ from: string; x: number; y: number; target: Cell | null } | null>(null)
  const [move, setMove] = useState<{ name: string; startX: number; startY: number; dx: number; dy: number; moved: boolean } | null>(
    null,
  )
  const movedRef = useRef(false)
  const [menu, setMenu] = useState<CanvasMenuState>(null)
  const [mode, setMode] = useState<Mode>('diagram')
  const [source, setSource] = useState('')
  const [sourceDirty, setSourceDirty] = useState(false)
  const [sourceErrors, setSourceErrors] = useState<FlowSchemaGraph['errors']>([])
  const [checking, setChecking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const viewRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ w: 0, h: 0 })

  const baseline = useMemo(() => graphKey(seeded.nodes, seeded.edges), [seeded])
  const dirty = sourceDirty || graphKey(nodes, edges) !== baseline
  const stageByKey = useMemo(() => new Map(stages.map((stage) => [stage.key, stage])), [stages])
  const stageOrder = useMemo(() => stages.map((stage) => stage.key), [stages])

  const stopUsed = edges.some((edge) => edge.dst === STOP)
  const laidOut = useMemo(() => {
    const withStop = stopUsed && !nodes.some((node) => node.name === STOP) ? [...nodes, blankNode(STOP)] : nodes
    return layout(withStop, edges, stageOrder)
  }, [nodes, edges, stageOrder, stopUsed])
  const placed = useMemo(() => {
    if (!drag || laidOut.pos.has(STOP)) return laidOut
    const cells = [...laidOut.cells.values()]
    const cell = freeCell({ col: Math.max(...cells.map((item) => item.col)) + 1, row: 0 }, new Set(cells.map(cellKey)))
    return {
      ...laidOut,
      pos: new Map(laidOut.pos).set(STOP, cellPoint(cell, laidOut.origin)),
      cells: new Map(laidOut.cells).set(STOP, cell),
    }
  }, [laidOut, drag])
  const visible = placed.pos.has(STOP) && !nodes.some((node) => node.name === STOP) ? [...nodes, blankNode(STOP)] : nodes

  const takenExcept = (name?: string) =>
    new Set([...placed.cells].filter(([key]) => key !== name).map(([, cell]) => cellKey(cell)))

  const posOf = (name: string): Point | undefined => {
    const at = placed.pos.get(name)
    if (!at || !move || move.name !== name) return at
    return { x: at.x + move.dx, y: at.y + move.dy }
  }

  const moveTarget =
    move && move.moved && placed.pos.get(move.name)
      ? freeCell(cellAt(posOf(move.name)!, placed.origin, true), takenExcept(move.name))
      : null

  useLayoutEffect(() => {
    const el = viewRef.current
    if (!el) return
    const measure = () => setView({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [mode])

  const fitScale = useMemo(() => {
    if (view.w < 8 || view.h < 8) return 1
    const availW = Math.max(120, view.w - VIEW_PAD * 2)
    const availH = Math.max(80, view.h - VIEW_PAD * 2)
    return Math.min(1, availW / Math.max(placed.width, 1), availH / Math.max(placed.height, 1))
  }, [placed.width, placed.height, view])

  const scale = fitScale
  const ready = view.w >= 8 && view.h >= 8
  const tx = view.w / 2 - (placed.width * scale) / 2
  const ty = view.h / 2 - (placed.height * scale) / 2

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (mode !== 'diagram' || !selected) return
      if (event.key !== 'Delete') return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      if (selected.kind === 'edge') removeEdge(selected.index)
      else if (!stageByKey.has(selected.name)) removeNode(selected.name)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    if (mode !== 'source') return
    const handle = window.setTimeout(async () => {
      setChecking(true)
      try {
        const parsed = await parseFlowSchema(source)
        setSourceErrors(parsed.errors)
      } catch {
        setSourceErrors([])
      } finally {
        setChecking(false)
      }
    }, 400)
    return () => window.clearTimeout(handle)
  }, [mode, source])

  const point = (event: { clientX: number; clientY: number }) => {
    const el = stageRef.current
    if (!el) return { x: 0, y: 0 }
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 }
    return {
      x: ((event.clientX - rect.left) / rect.width) * el.offsetWidth,
      y: ((event.clientY - rect.top) / rect.height) * el.offsetHeight,
    }
  }

  const titleOf = (name: string) => {
    if (name === STOP) return t('workstreamsPage.schema.stop')
    const node = nodes.find((item) => item.name === name)
    return node?.text || name
  }

  const updateNode = (name: string, patch: Partial<FlowSchemaNode>) =>
    setNodes((current) => current.map((item) => (item.name === name ? { ...item, ...patch } : item)))

  const updateEdge = (index: number, patch: Partial<FlowSchemaEdge>) =>
    setEdges((current) => current.map((edge, at) => (at === index ? { ...edge, ...patch } : edge)))

  const nextName = () => {
    const taken = new Set(nodes.map((node) => node.name))
    let index = nodes.filter((node) => node.name !== STOP).length + 1
    while (taken.has(`stap${index}`)) index += 1
    return `stap${index}`
  }

  const addStep = () => {
    const name = nextName()
    setNodes((current) => [...current.filter((node) => node.name !== STOP), blankNode(name, t('workstreamsPage.schema.newStep'))])
    setSelected({ kind: 'node', name })
  }

  const addStepAt = (src: string | null, cell: Cell) => {
    const name = nextName()
    setNodes((current) => [
      ...current.filter((node) => node.name !== STOP),
      { ...blankNode(name, t('workstreamsPage.schema.newStep')), plek: cellKey(cell) },
    ])
    if (src) setEdges((current) => [...current, blankEdge(src, name)])
    setSelected({ kind: 'node', name })
  }

  const openMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault()
    const box = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - box.left
    const y = event.clientY - box.top
    const target = event.target as HTMLElement
    const step = target.closest('[data-step]')?.getAttribute('data-step')
    const edge = target.closest('[data-edge]')?.getAttribute('data-edge')
    if (step && step !== STOP) {
      setSelected({ kind: 'node', name: step })
      setMenu({ x, y, kind: 'node', name: step })
    } else if (edge !== null && edge !== undefined) {
      const index = Number(edge)
      setSelected({ kind: 'edge', index })
      setMenu({ x, y, kind: 'edge', index })
    } else if (!step) {
      setMenu({ x, y, kind: 'canvas', cell: freeCell(cellAt(point(event), placed.origin), takenExcept()) })
    }
  }

  const lineTarget = (event: { clientX: number; clientY: number }, from: string, at: Point): Cell | null => {
    const hit = document.elementFromPoint(event.clientX, event.clientY)
    if (hit?.closest('[data-step]')) return null
    const source = placed.pos.get(from)
    if (source && Math.hypot(at.x - (source.x + CARD_W), at.y - (source.y + CARD_H / 2)) < 40) return null
    return freeCell(cellAt(at, placed.origin), takenExcept())
  }

  const startMove = (name: string, event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const at = point(event)
    movedRef.current = false
    setMove({ name, startX: at.x, startY: at.y, dx: 0, dy: 0, moved: false })
  }

  const continueMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!move) return
    const at = point(event)
    const dx = at.x - move.startX
    const dy = at.y - move.startY
    const moved = move.moved || Math.hypot(dx, dy) > 4
    if (moved) movedRef.current = true
    setMove({ ...move, dx, dy, moved })
  }

  const endMove = () => {
    if (move?.moved && moveTarget) updateNode(move.name, { plek: cellKey(moveTarget) })
    setMove(null)
  }

  const connect = (src: string, dst: string) => {
    if (!src || !dst || src === dst) return
    const existing = edges.findIndex((edge) => edge.src === src && edge.dst === dst && !edge.when)
    if (existing >= 0) {
      setSelected({ kind: 'edge', index: existing })
      return
    }
    setEdges((current) => [...current, blankEdge(src, dst)])
    setSelected({ kind: 'edge', index: edges.length })
  }

  const removeEdge = (index: number) => {
    setEdges((current) => current.filter((_, at) => at !== index))
    setSelected(null)
  }

  const removeNode = (name: string) => {
    setNodes((current) => current.filter((node) => node.name !== name))
    setEdges((current) => current.filter((edge) => edge.src !== name && edge.dst !== name))
    setSelected(null)
  }

  const switchMode = async (next: Mode) => {
    if (next === mode) return
    setError('')
    if (next === 'source') {
      try {
        const rendered = await renderFlowSchema({ nodes: nodes.filter((node) => node.name !== STOP), edges })
        setSource(rendered.source ?? '')
        setSourceErrors(rendered.errors)
        setSelected(null)
        setMode('source')
      } catch (err) {
        setError(formatApiErrorMessage(err, t('workstreamsPage.schema.invalid')))
      }
      return
    }
    try {
      const parsed = await parseFlowSchema(source)
      if (parsed.errors.length) {
        setSourceErrors(parsed.errors)
        setError(t('workstreamsPage.schema.invalid'))
        return
      }
      const graph = chainOf(stages, parsed)
      setNodes(graph.nodes)
      setEdges(graph.edges)
      setSourceDirty(false)
      setMode('diagram')
    } catch (err) {
      setError(formatApiErrorMessage(err, t('workstreamsPage.schema.invalid')))
    }
  }

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      let flowSource = ''
      if (mode === 'source') {
        const parsed = await parseFlowSchema(source)
        if (parsed.errors.length) {
          setSourceErrors(parsed.errors)
          setError(parsed.errors[0]?.message ?? t('workstreamsPage.schema.invalid'))
          return
        }
        flowSource = source
      } else {
        const rendered = await renderFlowSchema({ nodes: nodes.filter((node) => node.name !== STOP), edges })
        if (rendered.errors.length) {
          setError(rendered.errors[0]?.message ?? t('workstreamsPage.schema.invalid'))
          return
        }
        flowSource = rendered.source ?? ''
      }
      const row = await patchWorkstream(workstreamId, { flow_source: flowSource })
      onSaved(row)
      onClose()
    } catch (err) {
      setError(formatApiErrorMessage(err, t('workstreamsPage.schema.invalid')))
    } finally {
      setSaving(false)
    }
  }

  const clearOnBackground = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    if (!target.closest('[data-step], [data-edge], button, input, textarea')) setSelected(null)
  }

  const selectedNode = selected?.kind === 'node' ? nodes.find((node) => node.name === selected.name) ?? null : null
  const selectedEdge = selected?.kind === 'edge' ? edges[selected.index] ?? null : null
  const stepCount = nodes.filter((node) => node.name !== STOP).length

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3 pr-14">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-text-heading">{t('workstreamsPage.schema.title')}</h2>
          <p className="text-xs text-text-muted">
            {mode === 'diagram' ? t('workstreamsPage.schema.hint') : t('workstreamsPage.schema.sourceHint')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SegmentedControl
            size="sm"
            value={mode}
            onChange={(next) => void switchMode(next)}
            aria-label={t('workstreamsPage.schema.title')}
            options={[
              { value: 'diagram', label: t('workstreamsPage.schema.diagram') },
              { value: 'source', label: t('workstreamsPage.schema.source') },
            ]}
          />
          {mode === 'diagram' ? (
            <Button type="button" size="sm" variant="secondary" onClick={addStep}>
              <Plus size={14} aria-hidden />
              {t('workstreamsPage.schema.addStep')}
            </Button>
          ) : null}
          {dirty ? <span className="hidden text-xs text-text-muted md:inline">{t('workstreamsPage.editBar.unsaved')}</span> : null}
          <Button type="button" size="sm" variant="secondary" onClick={onClose}>
            {t('workstreamsPage.schema.close')}
          </Button>
          <Button type="button" size="sm" onClick={() => void save()} disabled={saving || !dirty}>
            {saving ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}
            {t('workstreamsPage.schema.save')}
          </Button>
        </div>
      </div>
      {error ? <p className="border-b border-border px-5 py-2 text-xs text-status-error">{error}</p> : null}

      {mode === 'source' ? (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col p-4">
            <Textarea
              value={source}
              onChange={(event) => {
                setSource(event.target.value)
                setSourceDirty(true)
              }}
              spellCheck={false}
              aria-label={t('workstreamsPage.schema.source')}
              className="min-h-0 flex-1 resize-none font-mono text-xs leading-relaxed"
            />
          </div>
          <aside className="w-80 shrink-0 overflow-y-auto border-l border-border bg-bg-surface p-4">
            <p className="mb-2 text-xs font-medium text-text-heading">{t('workstreamsPage.schema.errorsTitle')}</p>
            {checking ? (
              <p className="flex items-center gap-1.5 text-xs text-text-muted">
                <Loader2 size={12} className="animate-spin" aria-hidden />
              </p>
            ) : sourceErrors.length === 0 ? (
              <p className="text-xs text-status-success">{t('workstreamsPage.schema.sourceOk')}</p>
            ) : (
              <ul className="space-y-2">
                {sourceErrors.map((item, index) => (
                  <li key={`${item.line}-${index}`} className="rounded-md border border-status-error/30 bg-status-error/5 px-2.5 py-1.5 text-xs">
                    {item.line ? (
                      <span className="mr-1 font-medium text-status-error">{t('workstreamsPage.schema.errorLine', { line: item.line })}</span>
                    ) : null}
                    <span className="text-text-secondary">{item.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="relative min-w-0 flex-1 overflow-hidden bg-bg-base" onContextMenu={openMenu}>
            <DotGridBackground />
            <div
              ref={viewRef}
              className="absolute inset-0 touch-none"
              onPointerDown={clearOnBackground}
            >
              <div
                ref={stageRef}
                className="absolute left-0 top-0"
                style={{
                  width: placed.width,
                  height: placed.height,
                  transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
                  transformOrigin: '0 0',
                  opacity: ready ? 1 : 0,
                }}
              >
                <svg className="absolute inset-0 overflow-visible" width={placed.width} height={placed.height}>
                  <defs>
                    <marker id="flow-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                      <path d="M0,0 L8,4 L0,8 Z" className="fill-accent/60" />
                    </marker>
                    <marker id="flow-arrow-on" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                      <path d="M0,0 L8,4 L0,8 Z" className="fill-accent" />
                    </marker>
                  </defs>
                  {edges.map((edge, index) => {
                    const from = posOf(edge.src)
                    const to = posOf(edge.dst)
                    if (!from || !to) return null
                    const path = curve(from, to, laneOf(edges, index))
                    const on =
                      (selected?.kind === 'edge' && selected.index === index) ||
                      (selected?.kind === 'node' && (selected.name === edge.src || selected.name === edge.dst))
                    return (
                      <g key={`${edge.src}-${edge.dst}-${index}`}>
                        <path
                          d={path.d}
                          fill="none"
                          className={on ? 'stroke-accent' : 'stroke-accent/60'}
                          strokeWidth={on ? 2.25 : 1.75}
                          strokeDasharray={edge.dst === STOP ? '5 4' : undefined}
                          markerEnd={on ? 'url(#flow-arrow-on)' : 'url(#flow-arrow)'}
                        />
                        <path
                          d={path.d}
                          fill="none"
                          stroke="transparent"
                          strokeWidth={14}
                          data-edge={index}
                          className="cursor-pointer"
                          style={{ pointerEvents: 'stroke' }}
                          onClick={() => setSelected({ kind: 'edge', index })}
                        />
                      </g>
                    )
                  })}
                  {drag ? (
                    <line
                      x1={placed.pos.get(drag.from) ? placed.pos.get(drag.from)!.x + CARD_W : drag.x}
                      y1={placed.pos.get(drag.from) ? placed.pos.get(drag.from)!.y + CARD_H / 2 : drag.y}
                      x2={drag.x}
                      y2={drag.y}
                      className="stroke-accent"
                      strokeWidth={2}
                      strokeDasharray="4 4"
                    />
                  ) : null}
                </svg>

                {[drag?.target, moveTarget].map((cell, index) =>
                  cell ? (
                    <div
                      key={index === 0 ? 'line-target' : 'move-target'}
                      className="pointer-events-none absolute z-0 flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-accent/70 bg-accent/5 text-2xs text-accent"
                      style={{ ...cellStyle(cellPoint(cell, placed.origin)) }}
                    >
                      {index === 0 ? (
                        <>
                          <Plus size={12} aria-hidden />
                          {t('workstreamsPage.schema.newStep')}
                        </>
                      ) : null}
                    </div>
                  ) : null,
                )}

                {edges.map((edge, index) => {
                  const from = posOf(edge.src)
                  const to = posOf(edge.dst)
                  if (!from || !to) return null
                  const at = curve(from, to, laneOf(edges, index)).label
                  const active = selected?.kind === 'edge' && selected.index === index
                  const extra = [edge.geeft, edge.faalt, edge.stil].filter(Boolean).length
                  return (
                    <Button
                      key={`line-${edge.src}-${edge.dst}-${index}`}
                      type="button"
                      variant="ghost"
                      size="iconSm"
                      className={cn('absolute z-10 w-auto max-w-[150px] -translate-x-1/2 -translate-y-1/2 justify-start gap-1 border px-2 text-2xs font-normal shadow-sm',
 active
 ?'border-accent bg-accent text-accent-fg hover:bg-accent hover:text-accent-fg': edge.when || extra
 ?'border-accent/50 bg-bg-surface text-text-primary hover:border-accent hover:bg-bg-surface':'justify-center border-border bg-bg-surface px-0 text-text-muted hover:border-border hover:bg-bg-surface',
 )}
                      style={{ left: at.x, top: at.y }}
                      data-edge={index}
                      aria-label={t('workstreamsPage.schema.configureLine')}
                      title={edge.when || t('workstreamsPage.schema.configureLine')}
                      onClick={() => setSelected(active ? null : { kind: 'edge', index })}
                    >
                      {edge.when ? (
                        <span className="truncate">{edge.when}</span>
                      ) : extra ? (
                        <>
                          <Settings2 size={12} aria-hidden />
                          <span className="tabular-nums">{extra}</span>
                        </>
                      ) : (
                        <Settings2 size={13} aria-hidden />
                      )}
                    </Button>
                  )
                })}

                {visible.map((node) => {
                  const at = posOf(node.name)
                  if (!at) return null
                  const movable = node.name !== STOP && !stageByKey.has(node.name)
                  const stageIndex = stages.findIndex((stage) => stage.key === node.name)
                  const stage = stageIndex >= 0 ? stages[stageIndex] : undefined
                  const active = selected?.kind === 'node' && selected.name === node.name
                  if (node.name === STOP) {
                    return (
                      <div
                        key={node.name}
                        data-step={node.name}
                        className="absolute z-20 flex items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-bg-surface/80 text-sm text-text-secondary"
                        style={{ left: at.x, top: at.y + CARD_H / 4, width: CARD_W * 0.6, height: CARD_H / 2 }}
                      >
                        <Square size={12} aria-hidden />
                        {t('workstreamsPage.schema.stop')}
                      </div>
                    )
                  }
                  return (
                    <StepCard
                      key={node.name}
                      node={node}
                      stage={stage}
                      stageTitle={stage ? stageLabel(stage, t) : ''}
                      fill={stage ? waitingStageFill(stages, stageIndex) : undefined}
                      count={stage && counts ? counts[stage.key] ?? 0 : undefined}
                      at={at}
                      active={active}
                      lifted={move?.name === node.name && move.moved}
                      onSelect={() => {
                        if (movedRef.current) {
                          movedRef.current = false
                          return
                        }
                        setSelected({ kind: 'node', name: node.name })
                      }}
                      onMoveStart={movable ? (event) => startMove(node.name, event) : undefined}
                      onMoveContinue={movable ? continueMove : undefined}
                      onMoveEnd={movable ? endMove : undefined}
                      onDragStart={(event) => {
                        event.stopPropagation()
                        event.currentTarget.setPointerCapture(event.pointerId)
                        const atPoint = point(event)
                        setDrag({ from: node.name, x: atPoint.x, y: atPoint.y, target: null })
                      }}
                      onDragMove={(event) => {
                        if (!drag || drag.from !== node.name) return
                        const atPoint = point(event)
                        setDrag({ from: node.name, x: atPoint.x, y: atPoint.y, target: lineTarget(event, node.name, atPoint) })
                      }}
                      onDragEnd={(event) => {
                        const hit = document.elementFromPoint(event.clientX, event.clientY)
                        const step = hit?.closest('[data-step]')?.getAttribute('data-step')
                        if (step) connect(node.name, step)
                        else {
                          const cell = lineTarget(event, node.name, point(event))
                          if (cell) addStepAt(node.name, cell)
                        }
                        setDrag(null)
                      }}
                    />
                  )
                })}
              </div>
            </div>

            <p className="pointer-events-none absolute bottom-4 right-4 z-30 text-2xs text-text-muted">
              {t('workstreamsPage.schema.counts', { steps: stepCount, arrows: edges.length })}
            </p>
            <CanvasMenu
              menu={menu}
              nodes={nodes}
              edges={edges}
              stageKeys={stageOrder}
              titleOf={titleOf}
              onClose={() => setMenu(null)}
              onSelect={setSelected}
              onConnect={connect}
              onStepAfter={(name) => {
                const cell = placed.cells.get(name)
                if (cell) addStepAt(name, freeCell({ col: cell.col + 1, row: cell.row }, takenExcept()))
              }}
              onStepAt={(cell) => addStepAt(null, cell)}
              onUpdateNode={updateNode}
              onUpdateEdge={updateEdge}
              onRemoveNode={removeNode}
              onRemoveEdge={removeEdge}
              onSource={() => void switchMode('source')}
            />
          </div>

          <aside className="w-80 shrink-0 overflow-y-auto border-l border-border bg-bg-surface">
            {selectedNode ? (
              <StepInspector
                key={selectedNode.name}
                node={selectedNode}
                stage={stageByKey.get(selectedNode.name)}
                stageFill={(() => {
                  const index = stages.findIndex((stage) => stage.key === selectedNode.name)
                  return index >= 0 ? waitingStageFill(stages, index) : undefined
                })()}
                edges={edges}
                targets={[...nodes.map((node) => node.name).filter((name) => name !== selectedNode.name), STOP]}
                titleOf={titleOf}
                onChange={(patch) => updateNode(selectedNode.name, patch)}
                onSelectEdge={(index) => setSelected({ kind: 'edge', index })}
                onConnect={(dst) => connect(selectedNode.name, dst)}
                onRemove={stageByKey.has(selectedNode.name) ? undefined : () => removeNode(selectedNode.name)}
              />
            ) : selectedEdge && selected?.kind === 'edge' ? (
              <EdgeInspector
                key={selected.index}
                edge={selectedEdge}
                targets={[...nodes.map((node) => node.name).filter((name) => name !== selectedEdge.src), STOP]}
                titleOf={titleOf}
                onChange={(patch) => updateEdge(selected.index, patch)}
                onSelectNode={(name) => setSelected({ kind: 'node', name })}
                onRemove={() => removeEdge(selected.index)}
              />
            ) : (
              <div className="space-y-4 p-4">
                <p className="text-sm text-text-secondary">{t('workstreamsPage.schema.empty')}</p>
                <ul className="space-y-2 text-xs text-text-muted">
                  <li>{t('workstreamsPage.schema.tips.select')}</li>
                  <li>{t('workstreamsPage.schema.tips.draw')}</li>
                  <li>{t('workstreamsPage.schema.tips.move')}</li>
                  <li>{t('workstreamsPage.schema.tips.rightClick')}</li>
                </ul>
                <div className="space-y-1.5 border-t border-border pt-4">
                  {nodes.map((node) => {
                    const index = stages.findIndex((stage) => stage.key === node.name)
                    const stage = index >= 0 ? stages[index] : undefined
                    return (
                      <Button
                        key={node.name}
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelected({ kind: 'node', name: node.name })}
                        className="w-full justify-start gap-2 px-2 text-left font-normal text-text-primary"
                      >
                        {stage ? (
                          <StageProgressIcon kind={stage.kind} fill={waitingStageFill(stages, index)} size={14} />
                        ) : (
                          <Circle size={12} className="text-text-muted" aria-hidden />
                        )}
                        <span className="min-w-0 flex-1 truncate">{node.text || node.name}</span>
                        {stage && counts ? (
                          <span className="text-2xs tabular-nums text-text-muted">{counts[stage.key] ?? 0}</span>
                        ) : null}
                      </Button>
                    )
                  })}
                </div>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  )
}

function StepCard({
  node,
  stage,
  stageTitle,
  fill,
  count,
  at,
  active,
  lifted,
  onSelect,
  onMoveStart,
  onMoveContinue,
  onMoveEnd,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  node: FlowSchemaNode
  stage?: TicketStage
  stageTitle: string
  fill?: number
  count?: number
  at: Point
  active: boolean
  lifted: boolean
  onSelect: () => void
  /** Set for steps the operator may place by hand. */
  onMoveStart?: (event: ReactPointerEvent<HTMLDivElement>) => void
  onMoveContinue?: (event: ReactPointerEvent<HTMLDivElement>) => void
  onMoveEnd?: () => void
  onDragStart: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onDragMove: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onDragEnd: (event: ReactPointerEvent<HTMLButtonElement>) => void
}) {
  const { t } = useTranslation('nav')
  const tools = toolList(node.tools)
  const checklist = stage?.checklist?.length ?? 0
  const kindLabel = stage ? t(`workstreamsPage.stages.kinds.${stage.kind}`) : ''
  const subtitle = stage
    ? [
        node.text !== stageTitle ? stageTitle : kindLabel !== node.text ? kindLabel : t('workstreamsPage.stages.editTitle'),
        stage.waiting_on ? t(`tickets.waitingOn.${stage.waiting_on}`) : '',
      ]
        .filter(Boolean)
        .join(' · ')
    : t('workstreamsPage.schema.extraStep')
  return (
    <div
      data-step={node.name}
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onClick={onSelect}
      onPointerDown={onMoveStart}
      onPointerMove={onMoveContinue}
      onPointerUp={onMoveEnd}
      onPointerCancel={onMoveEnd}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect()
        }
      }}
      className={cn(
        'group absolute flex flex-col rounded-lg border bg-bg-surface px-3 py-2.5 text-left shadow-sm outline-none',
        'hover:border-border hover:shadow-md focus-visible:ring-1 focus-visible:ring-accent/60',
        onMoveStart ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
        lifted ? 'z-40 opacity-90 shadow-lg' : 'z-20 transition',
        active ? 'border-accent ring-1 ring-accent/40' : 'border-border',
      )}
      style={cellStyle(at)}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        {stage ? (
          <StageProgressIcon kind={stage.kind} fill={fill} size={15} />
        ) : (
          <Circle size={13} className="shrink-0 text-text-muted" aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-text-heading">{node.text || node.name}</span>
        {count !== undefined ? <span className="shrink-0 text-2xs tabular-nums text-text-muted">{count}</span> : null}
      </div>
      <p className="mt-0.5 truncate pl-[21px] text-2xs text-text-muted">{subtitle}</p>
      <div className="mt-auto flex min-w-0 items-center gap-1 overflow-hidden pl-[21px]">
        {node.wie ? (
          <Badge size="sm" variant={node.wie === 'user' ? 'neutral' : 'ai'} icon={Users}>
            {t(`workstreamsPage.schema.wie.${node.wie}`)}
          </Badge>
        ) : null}
        {node.max ? (
          <Badge size="sm" variant="neutral" icon={Clock}>
            {node.max}
          </Badge>
        ) : null}
        {tools.length ? (
          <Badge size="sm" variant="neutral" icon={Wrench} title={tools.join(', ')}>
            {tools.length}
          </Badge>
        ) : null}
        {checklist ? (
          <Badge size="sm" variant="neutral" icon={ListChecks} title={t('workstreamsPage.stages.checklist')}>
            {checklist}
          </Badge>
        ) : null}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="iconSm"
        aria-label={t('workstreamsPage.schema.draw')}
        className="absolute -right-2 top-1/2 h-4 w-4 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-accent bg-bg-surface p-0 opacity-0 shadow-sm transition-opacity hover:bg-accent group-hover:opacity-100"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => {
          event.stopPropagation()
          onDragStart(event)
        }}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
      />
    </div>
  )
}

type CanvasMenuState =
  | { x: number; y: number; kind: 'node'; name: string }
  | { x: number; y: number; kind: 'edge'; index: number }
  | { x: number; y: number; kind: 'canvas'; cell: Cell }
  | null

function CanvasMenu({
  menu,
  nodes,
  edges,
  stageKeys,
  titleOf,
  onClose,
  onSelect,
  onConnect,
  onStepAfter,
  onStepAt,
  onUpdateNode,
  onUpdateEdge,
  onRemoveNode,
  onRemoveEdge,
  onSource,
}: {
  menu: CanvasMenuState
  nodes: FlowSchemaNode[]
  edges: FlowSchemaEdge[]
  stageKeys: string[]
  titleOf: (name: string) => string
  onClose: () => void
  onSelect: (selection: Selection) => void
  onConnect: (src: string, dst: string) => void
  onStepAfter: (name: string) => void
  onStepAt: (cell: Cell) => void
  onUpdateNode: (name: string, patch: Partial<FlowSchemaNode>) => void
  onUpdateEdge: (index: number, patch: Partial<FlowSchemaEdge>) => void
  onRemoveNode: (name: string) => void
  onRemoveEdge: (index: number) => void
  onSource: () => void
}) {
  const { t } = useTranslation('nav')
  const node = menu?.kind === 'node' ? nodes.find((item) => item.name === menu.name) : undefined
  const edge = menu?.kind === 'edge' ? edges[menu.index] : undefined
  const extra = node ? !stageKeys.includes(node.name) : false
  const targetsFrom = (src: string) => [...nodes.map((item) => item.name).filter((name) => name !== src), STOP]

  return (
    <DropdownMenu open={menu !== null} onOpenChange={(open) => (open ? null : onClose())} modal={false}>
      <DropdownMenuTrigger asChild>
        <span aria-hidden className="pointer-events-none absolute h-0 w-0" style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={2} className="w-56" onCloseAutoFocus={(event) => event.preventDefault()}>
        {node ? (
          <>
            <DropdownMenuLabel className="truncate">{node.text || node.name}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => onSelect({ kind: 'node', name: node.name })}>
              <Settings2 size={14} className="mr-2" aria-hidden />
              {t('workstreamsPage.schema.menu.configure')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onStepAfter(node.name)}>
              <Plus size={14} className="mr-2" aria-hidden />
              {t('workstreamsPage.schema.menu.stepAfter')}
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <ArrowRight size={14} className="mr-2" aria-hidden />
                {t('workstreamsPage.schema.menu.arrowTo')}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
                {targetsFrom(node.name).map((name) => (
                  <DropdownMenuItem key={name} onSelect={() => onConnect(node.name, name)}>
                    {titleOf(name)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Users size={14} className="mr-2" aria-hidden />
                {t('workstreamsPage.schema.fields.wie')}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={node.wie || NONE} onValueChange={(value) => onUpdateNode(node.name, { wie: value === NONE ? '' : value })}>
                  {[NONE, ...WIE_VALUES].map((value) => (
                    <DropdownMenuRadioItem key={value} value={value}>
                      {t(`workstreamsPage.schema.wie.${value === NONE ? 'none' : value}`)}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Gauge size={14} className="mr-2" aria-hidden />
                {t('workstreamsPage.schema.fields.stand')}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={node.stand || NONE} onValueChange={(value) => onUpdateNode(node.name, { stand: value === NONE ? '' : value })}>
                  {[NONE, ...STAND_VALUES].map((value) => (
                    <DropdownMenuRadioItem key={value} value={value}>
                      {t(`workstreamsPage.schema.stand.${value === NONE ? 'none' : value}`)}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {extra ? (
              <>
                <DropdownMenuSeparator />
                {node.plek ? (
                  <DropdownMenuItem onSelect={() => onUpdateNode(node.name, { plek: '' })}>
                    <LayoutGrid size={14} className="mr-2" aria-hidden />
                    {t('workstreamsPage.schema.autoPlace')}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem className="text-status-error focus:text-status-error" onSelect={() => onRemoveNode(node.name)}>
                  <Trash2 size={14} className="mr-2" aria-hidden />
                  {t('workstreamsPage.schema.remove')}
                  <DropdownMenuShortcut>Del</DropdownMenuShortcut>
                </DropdownMenuItem>
              </>
            ) : null}
          </>
        ) : null}

        {edge && menu?.kind === 'edge' ? (
          <>
            <DropdownMenuLabel className="truncate">{`${titleOf(edge.src)} → ${titleOf(edge.dst)}`}</DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => onSelect({ kind: 'edge', index: menu.index })}>
              <Settings2 size={14} className="mr-2" aria-hidden />
              {t('workstreamsPage.schema.menu.configure')}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={edge.dst === STOP}
              onSelect={() => onUpdateEdge(menu.index, { src: edge.dst, dst: edge.src })}
            >
              <ArrowLeftRight size={14} className="mr-2" aria-hidden />
              {t('workstreamsPage.schema.menu.reverse')}
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <ArrowRight size={14} className="mr-2" aria-hidden />
                {t('workstreamsPage.schema.to')}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
                <DropdownMenuRadioGroup value={edge.dst} onValueChange={(dst) => onUpdateEdge(menu.index, { dst })}>
                  {targetsFrom(edge.src).map((name) => (
                    <DropdownMenuRadioItem key={name} value={name}>
                      {titleOf(name)}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-status-error focus:text-status-error" onSelect={() => onRemoveEdge(menu.index)}>
              <Trash2 size={14} className="mr-2" aria-hidden />
              {t('workstreamsPage.schema.remove')}
              <DropdownMenuShortcut>Del</DropdownMenuShortcut>
            </DropdownMenuItem>
          </>
        ) : null}

        {menu?.kind === 'canvas' ? (
          <>
            <DropdownMenuItem onSelect={() => onStepAt(menu.cell)}>
              <Plus size={14} className="mr-2" aria-hidden />
              {t('workstreamsPage.schema.menu.stepHere')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onSource}>
              <FileText size={14} className="mr-2" aria-hidden />
              {t('workstreamsPage.schema.menu.showSource')}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function InspectorHeader({ icon, kicker, title }: { icon: ReactNode; kicker: string; title: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-4 py-3">
      {icon}
      <div className="min-w-0">
        <p className="text-2xs uppercase tracking-wide text-text-muted">{kicker}</p>
        <p className="truncate text-sm font-medium text-text-heading">{title}</p>
      </div>
    </div>
  )
}

function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs text-text-secondary">{label}</Label>
      {children}
      {error ? <p className="text-2xs text-status-error">{error}</p> : hint ? <p className="text-2xs text-text-muted">{hint}</p> : null}
    </div>
  )
}

function StepInspector({
  node,
  stage,
  stageFill,
  edges,
  targets,
  titleOf,
  onChange,
  onSelectEdge,
  onConnect,
  onRemove,
}: {
  node: FlowSchemaNode
  stage?: TicketStage
  stageFill?: number
  edges: FlowSchemaEdge[]
  targets: string[]
  titleOf: (name: string) => string
  onChange: (patch: Partial<FlowSchemaNode>) => void
  onSelectEdge: (index: number) => void
  onConnect: (dst: string) => void
  onRemove?: () => void
}) {
  const { t } = useTranslation('nav')
  const outgoing = edges.map((edge, index) => ({ edge, index })).filter(({ edge }) => edge.src === node.name)
  const incoming = edges.map((edge, index) => ({ edge, index })).filter(({ edge }) => edge.dst === node.name)
  const maxInvalid = node.max.trim() !== '' && !MAX_RE.test(node.max.trim())
  return (
    <div>
      <InspectorHeader
        icon={stage ? <StageProgressIcon kind={stage.kind} fill={stageFill} size={18} /> : <Circle size={16} className="text-text-muted" aria-hidden />}
        kicker={stage ? t(`workstreamsPage.stages.kinds.${stage.kind}`) : t('workstreamsPage.schema.extraStep')}
        title={node.text || node.name}
      />
      <div className="space-y-4 p-4">
        <Field label={t('workstreamsPage.schema.text')} hint={stage ? t('workstreamsPage.schema.stageNote') : undefined}>
          <Input value={node.text} onChange={(event) => onChange({ text: event.target.value })} className="h-8 text-sm" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('workstreamsPage.schema.fields.wie')}>
            <Select value={node.wie || NONE} onValueChange={(value) => onChange({ wie: value === NONE ? '' : value })}>
              <SelectTrigger className="h-8 text-xs" aria-label={t('workstreamsPage.schema.fields.wie')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('workstreamsPage.schema.wie.none')}</SelectItem>
                {WIE_VALUES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`workstreamsPage.schema.wie.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('workstreamsPage.schema.fields.stand')}>
            <Select value={node.stand || NONE} onValueChange={(value) => onChange({ stand: value === NONE ? '' : value })}>
              <SelectTrigger className="h-8 text-xs" aria-label={t('workstreamsPage.schema.fields.stand')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>{t('workstreamsPage.schema.stand.none')}</SelectItem>
                {STAND_VALUES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`workstreamsPage.schema.stand.${value}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Field
          label={t('workstreamsPage.schema.fields.max')}
          hint={t('workstreamsPage.schema.maxHint')}
          error={maxInvalid ? t('workstreamsPage.schema.maxInvalid') : undefined}
        >
          <Input value={node.max} onChange={(event) => onChange({ max: event.target.value })} placeholder="2d" className="h-8 text-sm" />
        </Field>
        <Field label={t('workstreamsPage.schema.fields.tools')}>
          <Input
            value={node.tools}
            onChange={(event) => onChange({ tools: event.target.value })}
            placeholder={t('workstreamsPage.schema.placeholders.tools')}
            className="h-8 text-sm"
          />
        </Field>
        {(['krijgt', 'geeft', 'faalt', 'stil'] as const).map((key) => (
          <Field key={key} label={t(`workstreamsPage.schema.fields.${key}`)}>
            <Textarea
              value={node[key]}
              onChange={(event) => onChange({ [key]: event.target.value })}
              placeholder={t(`workstreamsPage.schema.placeholders.${key}`)}
              rows={2}
              className="min-h-14 text-sm"
            />
          </Field>
        ))}

        <div className="space-y-2 border-t border-border pt-4">
          <ArrowList
            label={t('workstreamsPage.schema.outgoing')}
            rows={outgoing.map(({ edge, index }) => ({ index, name: titleOf(edge.dst), when: edge.when }))}
            onSelect={onSelectEdge}
          />
          <ArrowList
            label={t('workstreamsPage.schema.incoming')}
            rows={incoming.map(({ edge, index }) => ({ index, name: titleOf(edge.src), when: edge.when }))}
            onSelect={onSelectEdge}
          />
          <Select value="" onValueChange={onConnect}>
            <SelectTrigger className="h-8 text-xs" aria-label={t('workstreamsPage.schema.connectTo')}>
              <SelectValue placeholder={t('workstreamsPage.schema.connectTo')} />
            </SelectTrigger>
            <SelectContent>
              {targets.map((name) => (
                <SelectItem key={name} value={name}>
                  {titleOf(name)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {onRemove && node.plek ? (
          <Button type="button" size="sm" variant="ghost" className="w-full justify-start text-text-muted" onClick={() => onChange({ plek: '' })}>
            <LayoutGrid size={14} aria-hidden />
            {t('workstreamsPage.schema.autoPlace')}
          </Button>
        ) : null}
        {onRemove ? (
          <Button type="button" size="sm" variant="ghost" className="w-full justify-start text-text-muted hover:text-status-error" onClick={onRemove}>
            <Trash2 size={14} aria-hidden />
            {t('workstreamsPage.schema.remove')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function ArrowList({
  label,
  rows,
  onSelect,
}: {
  label: string
  rows: Array<{ index: number; name: string; when: string }>
  onSelect: (index: number) => void
}) {
  const { t } = useTranslation('nav')
  return (
    <div>
      <p className="mb-1 text-xs text-text-secondary">{label}</p>
      {rows.length === 0 ? (
        <p className="text-2xs text-text-muted">{t('workstreamsPage.schema.noArrows')}</p>
      ) : (
        <ul className="space-y-0.5">
          {rows.map((row) => (
            <li key={row.index}>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => onSelect(row.index)}
                className="w-full justify-start gap-1.5 px-2 text-left font-normal text-text-primary"
              >
                <ArrowRight size={12} className="shrink-0 text-text-muted" aria-hidden />
                <span className="truncate">{row.name}</span>
                {row.when ? <span className="ml-auto max-w-[45%] truncate text-2xs text-text-muted">{row.when}</span> : null}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function EdgeInspector({
  edge,
  targets,
  titleOf,
  onChange,
  onSelectNode,
  onRemove,
}: {
  edge: FlowSchemaEdge
  targets: string[]
  titleOf: (name: string) => string
  onChange: (patch: Partial<FlowSchemaEdge>) => void
  onSelectNode: (name: string) => void
  onRemove: () => void
}) {
  const { t } = useTranslation('nav')
  return (
    <div>
      <InspectorHeader
        icon={<ArrowRight size={16} className="text-accent" aria-hidden />}
        kicker={t('workstreamsPage.schema.arrow')}
        title={`${titleOf(edge.src)} → ${titleOf(edge.dst)}`}
      />
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('workstreamsPage.schema.from')}>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => onSelectNode(edge.src)}
              className="justify-start truncate px-2 font-normal"
            >
              {titleOf(edge.src)}
            </Button>
          </Field>
          <Field label={t('workstreamsPage.schema.to')}>
            <Select value={edge.dst} onValueChange={(dst) => onChange({ dst })}>
              <SelectTrigger className="h-8 text-xs" aria-label={t('workstreamsPage.schema.to')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {targets.map((name) => (
                  <SelectItem key={name} value={name}>
                    {titleOf(name)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Field label={t('workstreamsPage.schema.when')}>
          <Input
            value={edge.when}
            onChange={(event) => onChange({ when: event.target.value })}
            placeholder={t('workstreamsPage.schema.placeholders.when')}
            className="h-8 text-sm"
          />
        </Field>
        {(['geeft', 'faalt', 'stil'] as const).map((key) => (
          <Field key={key} label={t(`workstreamsPage.schema.fields.${key}`)}>
            <Textarea
              value={edge[key]}
              onChange={(event) => onChange({ [key]: event.target.value })}
              placeholder={t(`workstreamsPage.schema.placeholders.${key}`)}
              rows={2}
              className="min-h-14 text-sm"
            />
          </Field>
        ))}
        <Button type="button" size="sm" variant="ghost" className="w-full justify-start text-text-muted hover:text-status-error" onClick={onRemove}>
          <Trash2 size={14} aria-hidden />
          {t('workstreamsPage.schema.remove')}
        </Button>
      </div>
    </div>
  )
}
