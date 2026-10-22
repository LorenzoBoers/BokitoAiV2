import type { OrgFlow, OrgFlowLabel, OrgFlowMode, OrgFlowNode, OrgFlowPath } from './org-flow-api'
import { NO_LABEL_KEY } from './org-flow-api'

/**
 * Geometry for the Grid. One layout drives both views: `2d` returns cards and
 * SVG paths in pixels, `3d` maps the same order onto four plates with the
 * Result plate bent back as a horseshoe next to Intake.
 */

export type Rect = { x: number; y: number; w: number; h: number }

export type CardBox = Rect & { nodeId: string; ghost: boolean; zoneId: string | null }

export type ZoneBox = Rect & { id: string; none: boolean }

export type PathStrip = {
  key: string
  labelKey: string | null
  d: string
  width: number
  color: string
  dash: string | null
}

export type PathGeometry = {
  id: string
  source: string
  target: string
  count: number
  mode: OrgFlowMode
  width: number
  d: string
  /** Lines without a flow travel over the free lane above the flow column. */
  laned: boolean
  strips: PathStrip[]
}

export type FlowLayout2D = {
  width: number
  height: number
  columns: { input: number; executor: number; work: number; result: number }
  zones: ZoneBox[]
  cards: CardBox[]
  paths: PathGeometry[]
  knowledgeLine: { d: string; labelX: number; labelY: number } | null
}

export const COLUMN = {
  input: { x: 16, w: 170 },
  zone: { x: 242, w: 238 },
  executor: { x: 262, w: 198 },
  work: { x: 546, w: 170 },
  result: { x: 786, w: 300 },
} as const

/** A department lane spans the executor and flow columns. */
const ZONE_RIGHT = COLUMN.work.x + COLUMN.work.w + 20
/** Column plates in 3D: this share of the 2D column width, centered on it. */
const PLATE_WIDTH_3D = 0.58
/** Gap between column plates in 3D, in scene units. */
const PLATE_GAP_3D = 0.55

const TOP = 48
const CARD_H = { input: 52, executor: 44, work: 52, sink: 52, knowledge: 64 }
const GAP = 14
const ZONE_HEADER = 30
const ZONE_PAD = 12
const ZONE_GAP = 14
const LANE_GAP = 6
const UNIT = 1 / 40

/** Line style per mode. Manual agent work is sent by a person, so it reads as human. */
export const MODE_STYLE: Record<OrgFlowMode, { color: string; dash: string | null; opacity: number }> = {
  autonomous: { color: '#32BF8E', dash: null, opacity: 0.9 },
  assisted: { color: '#8B5CF6', dash: '7 6', opacity: 0.85 },
  manual: { color: '#6A6A70', dash: null, opacity: 0.8 },
  human: { color: '#6A6A70', dash: null, opacity: 0.8 },
  none: { color: '#ECA530', dash: '2 5', opacity: 0.9 },
}

/** Label palette names from the API, as hex for SVG and WebGL. */
export const LABEL_HEX: Record<string, string> = {
  neutral: '#6A6A70',
  accent: '#6EDCB4',
  ai: '#8B5CF6',
  success: '#32BF8E',
  warning: '#ECA530',
  info: '#6096FF',
  rose: '#F43F5E',
  teal: '#14B8A6',
  violet: '#8B5CF6',
  orange: '#F97316',
  emerald: '#10B981',
  pink: '#EC4899',
  sky: '#38BDF8',
}

export function labelHex(color: string): string {
  return LABEL_HEX[color] ?? LABEL_HEX.neutral
}

export function labelKeyOf(label: OrgFlowLabel): string {
  return label.id ?? NO_LABEL_KEY
}

/** One strip and one filter for every label that has no flow, including unlabeled work. */
export const OTHER_LABEL_KEY = 'other'

export function isFlowLabel(label: OrgFlowLabel): boolean {
  return Boolean(label.flow_id)
}

/** Conversations on a path or node that are not on a flow label. */
export function otherLabelCount(bag: Record<string, number>, labels: OrgFlowLabel[]): number {
  const flow = new Set(labels.filter(isFlowLabel).map(labelKeyOf))
  return Object.entries(bag).reduce((sum, [key, count]) => sum + (flow.has(key) ? 0 : count), 0)
}

/** Log scale: a thousand conversations is not a thousand times thicker than one. */
export function pathWidth(count: number): number {
  return Math.min(10, Math.max(1.5, 1.5 + Math.log2(1 + count) * 1.1))
}

function byCountThenName(a: OrgFlowNode, b: OrgFlowNode): number {
  if (b.count !== a.count) return b.count - a.count
  return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
}

function resultHeight(node: OrgFlowNode): number {
  if (node.kind === 'reply') return 84
  if (node.kind === 'knowledge') return CARD_H.knowledge
  if (node.kind === 'folder') {
    const chips = node.works_in?.length ?? 0
    return chips > 3 ? 104 : 84
  }
  return CARD_H.sink
}

function curve(sx: number, sy: number, tx: number, ty: number): string {
  const mid = (sx + tx) / 2
  return `M${sx} ${sy} C${mid} ${sy} ${mid} ${ty} ${tx} ${ty}`
}

/** Out of the source, along the lane, down into the target: never through a flow card. */
function lanePath(sx: number, sy: number, laneY: number, laneFrom: number, laneTo: number, tx: number, ty: number): string {
  return [
    `M${sx} ${sy}`,
    `C${sx + 30} ${sy} ${laneFrom - 30} ${laneY} ${laneFrom} ${laneY}`,
    `L${laneTo} ${laneY}`,
    `C${laneTo + 30} ${laneY} ${tx - 30} ${ty} ${tx} ${ty}`,
  ].join(' ')
}

export type LayoutOptions = {
  /** Labels lens: split each path into strips per label. */
  labels?: boolean
}

export function layoutOrgFlow2D(data: OrgFlow, options: LayoutOptions = {}): FlowLayout2D {
  const byId = new Map(data.nodes.map((n) => [n.id, n]))
  const cards: CardBox[] = []
  const zones: ZoneBox[] = []
  const cardOf = new Map<string, CardBox>()

  // Intake.
  let y = TOP
  for (const node of data.nodes.filter((n) => n.layer === 'input').sort(byCountThenName)) {
    const card: CardBox = { nodeId: node.id, ghost: false, zoneId: null, x: COLUMN.input.x, y, w: COLUMN.input.w, h: CARD_H.input }
    cards.push(card)
    cardOf.set(node.id, card)
    y += CARD_H.input + GAP + 22
  }
  const inputBottom = y

  // Lane paths (executor to result) run above every department lane, so no line crosses a flow card.
  const flowIds = new Set(data.nodes.filter((n) => n.layer === 'work').map((n) => n.id))
  const laned = data.paths.filter((p) => byId.get(p.source)?.layer === 'executor' && byId.get(p.target)?.layer === 'result')
  const laneBand = laned.reduce((sum, p) => sum + pathWidth(p.count) + LANE_GAP, 0)
  const laneTop = TOP + 8
  const bandTop = flowIds.size ? Math.max(TOP + 40, laneTop + laneBand + 24) : TOP

  // Department lanes: executors on the left, the department's flows on the right.
  // A second department gets a ghost card.
  const executors = data.nodes.filter((n) => n.layer === 'executor' && n.kind !== 'unassigned')
  const zoneMembers = new Map<string, { main: OrgFlowNode[]; ghosts: OrgFlowNode[]; flows: OrgFlowNode[] }>()
  for (const zone of data.zones) zoneMembers.set(zone.id, { main: [], ghosts: [], flows: [] })
  for (const node of executors) {
    const ids = node.zones ?? []
    const main = ids[0] ?? 'none'
    zoneMembers.get(main)?.main.push(node)
    for (const ghost of ids.slice(1)) zoneMembers.get(ghost)?.ghosts.push(node)
  }
  const freeFlows: OrgFlowNode[] = []
  for (const node of data.nodes.filter((n) => n.layer === 'work')) {
    const lane = node.zones?.[0]
    const members = lane && lane !== 'none' ? zoneMembers.get(lane) : undefined
    if (members) members.flows.push(node)
    else freeFlows.push(node)
  }
  const sizeOf = (id: string) => {
    const m = zoneMembers.get(id)
    return m ? m.main.length + m.ghosts.length + m.flows.length : 0
  }
  const weight = (id: string) =>
    [...(zoneMembers.get(id)?.main ?? []), ...(zoneMembers.get(id)?.flows ?? [])].reduce((sum, n) => sum + n.count, 0)
  const zoneOrder = data.zones
    .filter((z) => z.id !== 'none' && sizeOf(z.id) > 0)
    .sort((a, b) => weight(b.id) - weight(a.id) || a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
  if ((zoneMembers.get('none')?.main.length ?? 0) > 0) {
    const none = data.zones.find((z) => z.id === 'none')
    if (none) zoneOrder.push(none)
  }
  y = bandTop
  for (const zone of zoneOrder) {
    const members = zoneMembers.get(zone.id) ?? { main: [], ghosts: [], flows: [] }
    const rows = [...members.main.sort(byCountThenName).map((n) => ({ n, ghost: false })), ...members.ghosts.sort(byCountThenName).map((n) => ({ n, ghost: true }))]
    const top = y
    let cy = y + ZONE_HEADER
    for (const row of rows) {
      const card: CardBox = { nodeId: row.n.id, ghost: row.ghost, zoneId: zone.id, x: COLUMN.executor.x, y: cy, w: COLUMN.executor.w, h: CARD_H.executor }
      cards.push(card)
      if (!row.ghost) cardOf.set(row.n.id, card)
      cy += CARD_H.executor + 8
    }
    let fy = y + ZONE_HEADER
    for (const node of members.flows.sort(byCountThenName)) {
      const card: CardBox = { nodeId: node.id, ghost: false, zoneId: zone.id, x: COLUMN.work.x, y: fy, w: COLUMN.work.w, h: CARD_H.work }
      cards.push(card)
      cardOf.set(node.id, card)
      fy += CARD_H.work + 12
    }
    const h = Math.max(cy - top + ZONE_PAD - 8, fy - top + ZONE_PAD - 12)
    const right = members.flows.length ? ZONE_RIGHT : COLUMN.zone.x + COLUMN.zone.w
    zones.push({ id: zone.id, none: zone.id === 'none', x: COLUMN.zone.x, y: top, w: right - COLUMN.zone.x, h })
    y = top + h + ZONE_GAP
  }
  const lanesBottom = y
  const unassigned = byId.get('executor:unassigned')
  if (unassigned) {
    const card: CardBox = { nodeId: unassigned.id, ghost: false, zoneId: null, x: COLUMN.executor.x, y: y + 4, w: COLUMN.executor.w, h: CARD_H.executor }
    cards.push(card)
    cardOf.set(unassigned.id, card)
    y += CARD_H.executor + 20
  }
  const executorBottom = y

  // Results: reply, folders, connections, knowledge, then the two sinks side by side.
  y = TOP
  const results = data.nodes.filter((n) => n.layer === 'result')
  const order = (n: OrgFlowNode) =>
    ({ reply: 0, folder: 1, connection: 2, knowledge: 3, sink_open: 4, sink_closed_without_result: 5 })[n.kind as 'reply'] ?? 6
  const main = results.filter((n) => order(n) < 4).sort((a, b) => order(a) - order(b) || byCountThenName(a, b))
  for (const node of main) {
    const h = resultHeight(node)
    const card: CardBox = { nodeId: node.id, ghost: false, zoneId: null, x: COLUMN.result.x, y, w: COLUMN.result.w, h }
    cards.push(card)
    cardOf.set(node.id, card)
    y += h + 16
  }
  // Inset from the column edges so both sinks stay on the narrowed 3D result plate.
  const sinkGap = 12
  const sinkInset = Math.round(COLUMN.result.w * (1 - PLATE_WIDTH_3D) * 0.5) + 8
  const sinkW = (COLUMN.result.w - sinkInset * 2 - sinkGap) / 2
  const sinks = ['result:open', 'result:closed_without_result'].map((id) => byId.get(id)).filter(Boolean) as OrgFlowNode[]
  sinks.forEach((node, i) => {
    const card: CardBox = {
      nodeId: node.id,
      ghost: false,
      zoneId: null,
      x: COLUMN.result.x + sinkInset + i * (sinkW + sinkGap),
      y,
      w: sinkW,
      h: CARD_H.sink,
    }
    cards.push(card)
    cardOf.set(node.id, card)
  })
  const resultBottom = y + (sinks.length ? CARD_H.sink + 16 : 0)

  // Flows outside a department lane (All's) sit below the lanes in the free column.
  y = Math.max(bandTop, lanesBottom)
  for (const node of freeFlows.sort(byCountThenName)) {
    const card: CardBox = { nodeId: node.id, ghost: false, zoneId: null, x: COLUMN.work.x, y, w: COLUMN.work.w, h: CARD_H.work }
    cards.push(card)
    cardOf.set(node.id, card)
    y += CARD_H.work + 16
  }
  const workBottom = y

  // Fan-out: stack each path's anchor along the card edge so lines do not overlap.
  const outOffset = new Map<string, number>()
  const inOffset = new Map<string, number>()
  const sorted = [...data.paths].sort((a, b) => {
    const ta = cardOf.get(a.target)?.y ?? 0
    const tb = cardOf.get(b.target)?.y ?? 0
    return ta - tb || b.count - a.count
  })
  const anchorsOut = new Map<string, number>()
  const anchorsIn = new Map<string, number>()
  for (const p of sorted) {
    anchorsOut.set(p.source, (anchorsOut.get(p.source) ?? 0) + pathWidth(p.count))
    anchorsIn.set(p.target, (anchorsIn.get(p.target) ?? 0) + pathWidth(p.count))
  }
  let laneCursor = laneTop
  const labelOrder = data.labels.map(labelKeyOf)
  const paths: PathGeometry[] = []
  for (const p of sorted) {
    const from = cardOf.get(p.source)
    const to = cardOf.get(p.target)
    if (!from || !to) continue
    const width = pathWidth(p.count)
    const outUsed = outOffset.get(p.source) ?? 0
    const inUsed = inOffset.get(p.target) ?? 0
    const sy = from.y + from.h / 2 - (anchorsOut.get(p.source) ?? 0) / 2 + outUsed + width / 2
    const ty = to.y + to.h / 2 - (anchorsIn.get(p.target) ?? 0) / 2 + inUsed + width / 2
    outOffset.set(p.source, outUsed + width)
    inOffset.set(p.target, inUsed + width)
    const sx = from.x + from.w
    const tx = to.x
    const isLane = byId.get(p.source)?.layer === 'executor' && byId.get(p.target)?.layer === 'result' && flowIds.size > 0
    let laneY = 0
    if (isLane) {
      laneY = laneCursor + width / 2
      laneCursor += width + LANE_GAP
    }
    const build = (dy: number) =>
      isLane
        ? lanePath(sx, sy + dy, laneY + dy, COLUMN.work.x - 10, COLUMN.work.x + COLUMN.work.w + 10, tx, ty + dy)
        : curve(sx, sy + dy, tx, ty + dy)
    const style = MODE_STYLE[p.mode]
    const strips: PathStrip[] = []
    if (options.labels) {
      const flowKeys = keysOfFlow(data.labels)
      const keys = Object.keys(p.by_label)
        .filter((key) => flowKeys.has(key))
        .sort((a, b) => {
          const ia = labelOrder.indexOf(a)
          const ib = labelOrder.indexOf(b)
          return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib)
        })
      const parts: Array<{ key: string; count: number; color: string }> = keys.map((key) => ({
        key,
        count: p.by_label[key] ?? 0,
        color: labelHex(data.labels.find((l) => labelKeyOf(l) === key)?.color ?? 'neutral'),
      }))
      const other = otherLabelCount(p.by_label, data.labels)
      if (other > 0) parts.push({ key: OTHER_LABEL_KEY, count: other, color: labelHex('neutral') })
      let offset = -width / 2
      for (const part of parts) {
        const share = part.count / Math.max(1, p.count)
        const w = Math.max(1, width * share)
        strips.push({
          key: `${p.source}->${p.target}:${part.key}`,
          labelKey: part.key,
          d: build(offset + w / 2),
          width: w,
          color: part.color,
          dash: null,
        })
        offset += w
      }
    }
    paths.push({ id: `${p.source}->${p.target}`, source: p.source, target: p.target, count: p.count, mode: p.mode, width, d: build(0), laned: isLane, strips: strips.length ? strips : [{ key: `${p.source}->${p.target}`, labelKey: null, d: build(0), width, color: style.color, dash: style.dash }] })
  }

  // Knowledge: a dotted line along the right edge of the reply card.
  let knowledgeLine: FlowLayout2D['knowledgeLine'] = null
  const reply = cardOf.get('result:reply')
  const knowledge = cardOf.get('result:knowledge')
  if (reply && knowledge && data.paths.some((p) => p.source === 'result:reply' && p.target === 'result:knowledge')) {
    const edge = COLUMN.result.x + COLUMN.result.w + 24
    const y1 = reply.y + 20
    const y2 = knowledge.y + knowledge.h / 2
    knowledgeLine = {
      d: `M${reply.x + reply.w} ${y1} H${edge} V${y2} H${knowledge.x + knowledge.w + 2}`,
      labelX: edge + 6,
      labelY: (y1 + y2) / 2,
    }
  }

  return {
    width: COLUMN.result.x + COLUMN.result.w + 80,
    height: Math.max(inputBottom, executorBottom, workBottom, resultBottom) + 24,
    columns: { input: COLUMN.input.x, executor: COLUMN.zone.x, work: COLUMN.work.x, result: COLUMN.result.x },
    zones,
    cards,
    paths: paths.filter((p) => !(p.source === 'result:reply' && p.target === 'result:knowledge')),
    knowledgeLine,
  }
}

/** Is any path segment drawn through a flow card? Used by tests. */
export function crossesFlowCard(layout: FlowLayout2D, path: PathGeometry): boolean {
  if (!path.laned) return false
  const laneY = Number(path.d.split('L')[1]?.trim().split(' ')[1] ?? NaN)
  return layout.cards
    .filter((c) => c.nodeId.startsWith('flow:'))
    .some((c) => laneY >= c.y && laneY <= c.y + c.h)
}

export type Plate = { layer: string; points: Array<[number, number]> }

export type FlowLayout3D = {
  nodes: Array<{ nodeId: string; x: number; z: number; ghost: boolean; zoneId: string | null }>
  zones: Array<{ id: string; none: boolean; x: number; z: number; w: number; d: number }>
  plates: Plate[]
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
}

/** 3D: the four 2D columns as plates in one row; every mark sits where its 2D card sits. */
export function layoutOrgFlow3D(data: OrgFlow): FlowLayout3D {
  const flat = layoutOrgFlow2D(data)
  const columns = [
    { layer: 'input' as const, ...COLUMN.input },
    { layer: 'executor' as const, ...COLUMN.zone },
    { layer: 'work' as const, ...COLUMN.work },
    { layer: 'result' as const, ...COLUMN.result },
  ]
  // Plates sit side by side with one small gap; each column's marks move with their plate.
  let left = (columns[0].x + (columns[0].w * (1 - PLATE_WIDTH_3D)) / 2) * UNIT
  const placed = columns.map((col) => {
    const w = col.w * PLATE_WIDTH_3D * UNIT
    const shift = left + w / 2 - (col.x + col.w / 2) * UNIT
    const plate = { layer: col.layer, left, right: left + w, shift }
    left += w + PLATE_GAP_3D
    return plate
  })
  const shiftAt = (x: number) => {
    const i = columns.findIndex((col) => x >= col.x && x <= col.x + col.w)
    if (i >= 0) return placed[i].shift
    const nearest = columns.reduce((best, col, k) =>
      Math.abs(x - (col.x + col.w / 2)) < Math.abs(x - (columns[best].x + columns[best].w / 2)) ? k : best, 0)
    return placed[nearest].shift
  }
  const nodes: FlowLayout3D['nodes'] = flat.cards.map((c) => ({
    nodeId: c.nodeId,
    x: (c.x + c.w / 2) * UNIT + shiftAt(c.x + c.w / 2),
    z: (c.y + c.h / 2) * UNIT,
    ghost: c.ghost,
    zoneId: c.zoneId,
  }))
  // A lane with flows spans the executor and flow plates; otherwise it stays on the executor plate.
  const zones = flat.zones.map((z) => {
    const left = placed[1].left + 0.1
    const right = z.x + z.w > COLUMN.zone.x + COLUMN.zone.w ? placed[2].right - 0.1 : placed[1].right - 0.1
    return { id: z.id, none: z.none, x: (left + right) / 2, z: (z.y + z.h / 2) * UNIT, w: right - left, d: z.h * UNIT }
  })
  const bottom = Math.max(...flat.cards.map((c) => (c.y + c.h) * UNIT), ...zones.map((z) => z.z + z.d / 2), 4)
  const plates: Plate[] = placed.map((p) => ({
    layer: p.layer,
    points: [
      [p.left, 0.4],
      [p.right, 0.4],
      [p.right, bottom + 0.4],
      [p.left, bottom + 0.4],
    ],
  }))
  const corners = plates.flatMap((p) => p.points)
  return {
    nodes,
    zones,
    plates,
    bounds: {
      minX: Math.min(...corners.map((c) => c[0])),
      maxX: Math.max(...corners.map((c) => c[0])),
      minZ: Math.min(...corners.map((c) => c[1])),
      maxZ: Math.max(...corners.map((c) => c[1])),
    },
  }
}

/** Open per label, biggest first: the stacked bar in 2D and the stacked column in 3D. */
export function openStack(node: OrgFlowNode, labels: OrgFlowLabel[]): Array<{ key: string; count: number; color: string }> {
  const flow = keysOfFlow(labels)
  const rows: Array<{ key: string; count: number; color: string }> = []
  let other = 0
  for (const [key, count] of Object.entries(node.open_by_label)) {
    if (count <= 0) continue
    if (!flow.has(key)) {
      other += count
      continue
    }
    rows.push({ key, count, color: labelHex(labels.find((l) => labelKeyOf(l) === key)?.color ?? 'neutral') })
  }
  if (other > 0) rows.push({ key: OTHER_LABEL_KEY, count: other, color: labelHex('neutral') })
  return rows.sort((a, b) => b.count - a.count)
}

function keysOfFlow(labels: OrgFlowLabel[]): Set<string> {
  return new Set(labels.filter(isFlowLabel).map(labelKeyOf))
}

/** Column height in 3D: grows with open work, capped so one busy agent does not hide the rest. */
export function columnHeight(open: number, k = 0.6, cap = 4): number {
  return Math.min(Math.log2(1 + open) * k, cap)
}

export type GridLens = 'flow' | 'labels' | 'autonomy'

export const GRID_LENSES: GridLens[] = ['flow', 'labels', 'autonomy']

export type Emphasis = {
  /** Null: nothing is dimmed. */
  litNodes: Set<string> | null
  litPaths: Set<string> | null
  /** Labels lens with one label isolated: strips of other labels dim. */
  label: string | null
}

const pathKey = (p: Pick<OrgFlowPath, 'source' | 'target'>) => `${p.source}->${p.target}`

/** Which cards and lines stay lit for a hover or an isolated label. */
export function emphasis(
  data: OrgFlow,
  lens: GridLens,
  { focus = null, label = null, zone = null }: { focus?: string | null; label?: string | null; zone?: string | null } = {},
): Emphasis {
  if (focus) {
    const nodes = new Set([focus])
    const paths = new Set<string>()
    for (const p of data.paths) {
      if (p.source !== focus && p.target !== focus) continue
      paths.add(pathKey(p))
      nodes.add(p.source)
      nodes.add(p.target)
    }
    return { litNodes: nodes, litPaths: paths, label: lens === 'labels' ? label : null }
  }
  if (lens === 'labels' && label) {
    const has = (bag: Record<string, number>) =>
      label === OTHER_LABEL_KEY ? otherLabelCount(bag, data.labels) > 0 : (bag[label] ?? 0) > 0
    const paths = new Set(data.paths.filter((p) => has(p.by_label)).map(pathKey))
    const nodes = new Set(data.nodes.filter((n) => has(n.open_by_label)).map((n) => n.id))
    for (const p of data.paths) {
      if (!paths.has(pathKey(p))) continue
      nodes.add(p.source)
      nodes.add(p.target)
    }
    return { litNodes: nodes, litPaths: paths, label }
  }
  if (zone) {
    // One department: its executors and flows, and whatever they connect to.
    const own = new Set(data.nodes.filter((n) => n.zones?.[0] === zone).map((n) => n.id))
    const nodes = new Set(own)
    const paths = new Set<string>()
    for (const p of data.paths) {
      if (!own.has(p.source) && !own.has(p.target)) continue
      paths.add(pathKey(p))
      nodes.add(p.source)
      nodes.add(p.target)
    }
    return { litNodes: nodes, litPaths: paths, label: null }
  }
  return { litNodes: null, litPaths: null, label: null }
}

export function isLit(set: Set<string> | null, id: string): boolean {
  return set === null || set.has(id)
}

export function pathsOf(nodeId: string, paths: OrgFlowPath[]): { incoming: OrgFlowPath[]; outgoing: OrgFlowPath[] } {
  return {
    incoming: paths.filter((p) => p.target === nodeId),
    outgoing: paths.filter((p) => p.source === nodeId),
  }
}
