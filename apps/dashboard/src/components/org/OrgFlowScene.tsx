import { useEffect, useRef, type MutableRefObject } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useTranslation } from 'react-i18next'
import * as THREE from 'three'
import CameraControls from 'camera-controls'
import type { Line2 } from 'three/addons/lines/Line2.js'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { useTheme } from '../../context/ThemeContext'
import { NO_LABEL_KEY, type OrgFlow, type OrgFlowNode } from '../../lib/org-flow-api'
import {
  MODE_STYLE,
  columnHeight,
  emphasis,
  isLit,
  OTHER_LABEL_KEY,
  labelHex,
  labelKeyOf,
  otherLabelCount,
  layoutOrgFlow2D,
  layoutOrgFlow3D,
  openStack,
  type Emphasis,
  type GridLens,
} from '../../lib/org-flow-layout'
import { arcPoints, makeArc, setArcOpacity } from './org3d/arcs'
import { declutterChips, makeNodeChip, makeTitle, type ChipSlot } from './org3d/labels'
import { mountFace, type MountedFace } from './org3d/faces'
import { makeColumn, makeFlatMark, makePuck, makeSlab, makeWorksInCubes, makeZone, materialsOf } from './org3d/plates'
import { cssRgbHex, makeSoftGrid, makeStageFloor, themePalette } from './org3d/stage'
import { useGridNames } from './org-flow-names'
import { TagPill } from '../ui/TagPill'
import type { LabelColor } from '../../lib/signals-api'

CameraControls.install({ THREE })

export type FlowZoomApi = {
  zoomBy: (factor: number) => void
  reset: () => void
}

type Props = {
  data: OrgFlow
  lens: GridLens
  label: string | null
  selectedId: string | null
  hoverId: string | null
  onHover: (id: string | null) => void
  onSelect: (id: string) => void
  /** Page-owned zoom buttons share this so they can sit in the bottom bar. */
  zoomApiRef?: MutableRefObject<FlowZoomApi | null>
  onZoomPct?: (pct: number) => void
}

/** Layout units are 2D pixels; the scene keeps them so widths and dashes match. */
const SCALE = 40
const COLUMN_UNIT = 14
const ZOOM_MAX = 3
const LERP = 0.2
const DIM = 0.16
/** How close the pointer must be, in screen pixels, to read a line. */
const ARC_HIT_PX = 12

/** Closest point on a polyline to a screen position. Distance is in pixels. */
function closestOnArc(
  points: THREE.Vector3[],
  mx: number,
  my: number,
  camera: THREE.Camera,
  width: number,
  height: number,
): { dist: number; point: THREE.Vector3 } {
  const ndc = new THREE.Vector3()
  const screen = points.map((p) => {
    ndc.copy(p).project(camera)
    return { x: (ndc.x * 0.5 + 0.5) * width, y: (-ndc.y * 0.5 + 0.5) * height }
  })
  let best = Infinity
  let bestPoint = points[0]
  for (let i = 0; i < screen.length - 1; i++) {
    const a = screen[i]
    const b = screen[i + 1]
    const abx = b.x - a.x
    const aby = b.y - a.y
    const len2 = abx * abx + aby * aby || 1
    const t = Math.min(1, Math.max(0, ((mx - a.x) * abx + (my - a.y) * aby) / len2))
    const d = Math.hypot(mx - (a.x + abx * t), my - (a.y + aby * t))
    if (d < best) {
      best = d
      bestPoint = points[i].clone().lerp(points[i + 1], t)
    }
  }
  return { dist: best, point: bestPoint }
}

const KIND_HEX: Record<string, number> = {
  channel: 0x38bdf8,
  agent: 0xa78bfa,
  user: 0x2dd4bf,
  unassigned: 0xeca530,
  flow: 0xf472b6,
  reply: 0x60a5fa,
  folder: 0xf59e0b,
  knowledge: 0xcbd5e1,
  sink_open: 0x6a6a70,
  sink_closed_without_result: 0x6a6a70,
}

/** Column plates are neutral slabs; color stays on the marks and lines. */
const SLAB_HEIGHT = 4
const SLAB = {
  dark: { top: 0x1c1c1f, side: 0x0e0e10, edge: 0x2c2c31 },
  light: { top: 0xffffff, side: 0xe8e8e4, edge: 0xd4d4d0 },
}

function radiusOf(node: OrgFlowNode): number {
  if (node.layer === 'executor') return 9
  if (node.kind === 'folder' || node.kind === 'reply') return 12
  return 10
}

type Mark = {
  node: OrgFlowNode
  group: THREE.Group
  materials: Array<THREE.Material & { opacity: number }>
  chip: HTMLButtonElement
  slot: ChipSlot
  ghost: boolean
}

/** Grid in 3D: four plates in the 2D order, Result bent back as a horseshoe next to Intake. */
export function OrgFlowScene({ data, lens, label, selectedId, hoverId, onHover, onSelect, zoomApiRef, onZoomPct }: Props) {
  const { t } = useTranslation('nav')
  const names = useGridNames()
  const { isDark } = useTheme()
  const hostRef = useRef<HTMLDivElement>(null)
  const controlsRef = useRef<CameraControls | null>(null)
  const homeRef = useRef<{ lookAt: [number, number, number, number, number, number]; zoom: number } | null>(null)
  const onZoomPctRef = useRef(onZoomPct)
  onZoomPctRef.current = onZoomPct
  const stateRef = useRef<{ lit: Emphasis; selectedId: string | null }>({ lit: emphasis(data, lens, { label }), selectedId })
  stateRef.current = { lit: emphasis(data, lens, { focus: hoverId, label }), selectedId }
  const handlersRef = useRef({ onHover, onSelect })
  handlersRef.current = { onHover, onSelect }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const palette = themePalette(isDark)
    const scene = new THREE.Scene()
    // The stage continues the page: same color as the surface around it.
    const pageBg = cssRgbHex('--color-bg')
    scene.background = new THREE.Color(pageBg)

    const width = host.clientWidth || 800
    const height = host.clientHeight || 600
    const frustum = 300
    const camera = new THREE.OrthographicCamera(
      (-frustum * (width / height)) / 2,
      (frustum * (width / height)) / 2,
      frustum / 2,
      -frustum / 2,
      0.1,
      12000,
    )
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(width, height)
    renderer.toneMapping = THREE.NoToneMapping
    renderer.shadowMap.enabled = isDark
    host.appendChild(renderer.domElement)
    const resolution = new THREE.Vector2(width, height)

    const labelRenderer = new CSS2DRenderer()
    labelRenderer.setSize(width, height)
    labelRenderer.domElement.style.position = 'absolute'
    labelRenderer.domElement.style.inset = '0'
    labelRenderer.domElement.style.pointerEvents = 'none'
    labelRenderer.domElement.style.overflow = 'hidden'
    host.appendChild(labelRenderer.domElement)

    scene.add(new THREE.AmbientLight(palette.ambient, palette.ambientIntensity))
    const key = new THREE.DirectionalLight(0xffffff, palette.keyIntensity)
    key.position.set(400, 700, 300)
    key.castShadow = true
    scene.add(key)

    const layout = layoutOrgFlow3D(data)
    const flat = layoutOrgFlow2D(data, { labels: lens === 'labels' })
    const cx = ((layout.bounds.minX + layout.bounds.maxX) / 2) * SCALE
    const cz = ((layout.bounds.minZ + layout.bounds.maxZ) / 2) * SCALE
    const span = Math.max((layout.bounds.maxX - layout.bounds.minX) * SCALE, (layout.bounds.maxZ - layout.bounds.minZ) * SCALE, 200)

    const floor = makeStageFloor(Math.max(5200, span * 4), pageBg, pageBg)
    floor.position.set(cx, -SLAB_HEIGHT - 0.5, cz)
    scene.add(floor)
    const gridSize = Math.max(2800, span * 2.2)
    const grid = makeSoftGrid(gridSize, Math.round(gridSize / 80), palette.gridMajor, palette.gridMajor, palette.gridOpacity, {
      minX: layout.bounds.minX * SCALE,
      maxX: layout.bounds.maxX * SCALE,
      minZ: layout.bounds.minZ * SCALE,
      maxZ: layout.bounds.maxZ * SCALE,
      feather: 220,
    })
    grid.position.set(cx, -SLAB_HEIGHT + 0.05, cz)
    scene.add(grid)

    const columnTitles: Record<string, [string, string]> = {
      input: [t('orgCanvas.columns.input'), ''],
      executor: [t('orgCanvas.columns.executor'), t('orgCanvas.columns.executorSub')],
      work: [t('orgCanvas.columns.work'), t('orgCanvas.columns.workSub')],
      result: [t('orgCanvas.columns.result'), t('orgCanvas.columns.resultSub')],
    }
    const titleColor = isDark ? '#7a7a78' : '#5c5c62'
    for (const plate of layout.plates) {
      const points = plate.points.map(([x, z]) => [x * SCALE, z * SCALE] as [number, number])
      scene.add(makeSlab(points, isDark ? SLAB.dark : SLAB.light, SLAB_HEIGHT))
      const [text, sub] = columnTitles[plate.layer] ?? ['', '']
      const title = makeTitle(text, sub, titleColor)
      // Centered on the front edge (max Z): the start camera looks from +Z, so this edge is nearest.
      const frontZ = points[3][1]
      const midX = (points[2][0] + points[3][0]) / 2
      title.center.set(0.5, 1)
      title.position.set(midX, 2, frontZ + 28)
      scene.add(title)
    }

    const zoneInfo = new Map(data.zones.map((z) => [z.id, z]))
    for (const zone of layout.zones) {
      const color = zone.none ? 0xeca530 : 0x6096ff
      scene.add(makeZone(zone.x * SCALE, zone.z * SCALE, zone.w * SCALE - 8, zone.d * SCALE - 6, color, zone.none))
      const info = zoneInfo.get(zone.id)
      const name = zone.none ? t('orgCanvas.zone.none') : (info?.label ?? '')
      const hint = info?.hint ? t(`orgCanvas.zone.hint.${info.hint}`) : ''
      const title = makeTitle(name, hint, zone.none ? '#eca530' : '#8fb4ff')
      title.element.style.textTransform = 'none'
      title.element.style.letterSpacing = '0'
      title.position.set((zone.x - zone.w / 2) * SCALE + 4, 2, (zone.z - zone.d / 2) * SCALE + 4)
      scene.add(title)
    }

    // Marks.
    const byId = new Map(data.nodes.map((n) => [n.id, n]))
    const marks: Mark[] = []
    const markById = new Map<string, Mark>()
    const pickables: THREE.Object3D[] = []
    const faces: MountedFace[] = []
    const zoneName = (id: string) => (id === 'none' ? t('orgCanvas.zone.none') : (zoneInfo.get(id)?.label ?? ''))
    for (const pos of layout.nodes) {
      const node = byId.get(pos.nodeId)
      if (!node) continue
      const group = new THREE.Group()
      group.position.set(pos.x * SCALE, 0, pos.z * SCALE)
      const radius = radiusOf(node)
      const autonomyColor =
        lens === 'autonomy' && node.autonomy ? new THREE.Color(MODE_STYLE[node.autonomy].color).getHex() : null
      const flowColor = node.kind === 'flow' && node.color ? new THREE.Color(labelHex(node.color)).getHex() : null
      const color = autonomyColor ?? flowColor ?? KIND_HEX[node.kind] ?? 0x94a3b8
      // Pillar only when there is open work; otherwise a flat disc with an outer ring.
      const hasPillar = !pos.ghost && node.layer === 'executor' && node.open > 0
      let top = 5
      if (hasPillar) {
        const puck = makePuck(color, radius, 4, 1)
        puck.userData.nodeId = node.id
        group.add(puck)
        pickables.push(puck)
        const total = columnHeight(node.open) * COLUMN_UNIT
        const overloaded = node.issues.includes('overloaded')
        const segments =
          lens === 'labels'
            ? openStack(node, data.labels).map((s) => ({ height: (s.count / node.open) * total, color: s.color }))
            : [{ height: total, color: overloaded ? 0xeca530 : color }]
        const column = makeColumn(segments, 7.5, 5, { dark: isDark })
        column.traverse((c) => {
          if ((c as THREE.Mesh).isMesh) {
            c.userData.nodeId = node.id
            pickables.push(c)
          }
        })
        group.add(column)
        top += total + 2
      } else {
        const flat = makeFlatMark(color, radius, pos.ghost ? 0.35 : 1, isDark)
        flat.traverse((c) => {
          if ((c as THREE.Mesh).isMesh) {
            c.userData.nodeId = node.id
            pickables.push(c)
          }
        })
        group.add(flat)
        top = 4
      }
      if (node.kind === 'folder' && node.works_in?.length) group.add(makeWorksInCubes(node.works_in, radius, top))

      const meta = pos.ghost
        ? t('orgCanvas.node.ghost', { name: node.zones?.[0] ? zoneName(node.zones[0]) : '' })
        : node.layer === 'executor' && node.kind !== 'unassigned'
          ? lens === 'autonomy' && node.autonomy
            ? t(`orgCanvas.mode.${node.autonomy}`)
            : node.waiting_on_you
              ? `${t('orgCanvas.node.open', { count: node.open })} · ${t('orgCanvas.node.waiting', { count: node.waiting_on_you })}`
              : t('orgCanvas.node.open', { count: node.open })
          : node.kind === 'channel'
            ? names.channel(node.channel)
            : node.kind === 'flow'
              ? (node.module?.name ?? (node.done ? t('orgCanvas.node.done', { count: node.done }) : ''))
              : node.kind === 'sink_open' || node.kind === 'sink_closed_without_result'
                ? String(node.kind === 'sink_open' ? node.open || node.count : node.count)
                : t('orgCanvas.node.conversations', { count: node.count })
      const face = mountFace(node)
      if (face) faces.push(face)
      const chip = makeNodeChip(
        {
          face: face?.el,
          nodeId: pos.ghost ? `${node.id}:ghost` : node.id,
          name: names.node(node),
          meta,
          metaColor: node.waiting_on_you && !pos.ghost ? '#f08a8d' : node.issues.includes('overloaded') ? '#eca530' : undefined,
        },
        palette,
        {
          onEnter: () => handlersRef.current.onHover(node.id),
          onLeave: () => handlersRef.current.onHover(null),
          onClick: () => handlersRef.current.onSelect(node.id),
        },
      )
      if (pos.ghost) chip.el.style.borderStyle = 'dashed'
      chip.object.position.set(0, top + 4, 0)
      group.add(chip.object)
      scene.add(group)
      const slot: ChipSlot = { object: chip.object, el: chip.el, dx: chip.dx, priority: (pos.ghost ? 0 : 1_000_000) + node.count + node.open }
      const mark: Mark = { node, group, materials: materialsOf(group), chip: chip.el, slot, ghost: pos.ghost }
      marks.push(mark)
      if (!pos.ghost) markById.set(node.id, mark)
    }

    // Arcs: same strips, widths and dashes as 2D.
    const arcs: Array<{
      line: Line2
      pathId: string
      labelKey: string | null
      points: THREE.Vector3[]
      title: string
      detail: string
      pill: { name: string; flow: boolean; color: string; icon: string } | null
    }> = []
    const anchor = (id: string) => {
      const mark = markById.get(id)
      return mark ? mark.group.position.clone().add(new THREE.Vector3(0, 6, 0)) : null
    }
    const pillFor = (key: string | null) => {
      if (!key) return null
      if (key === OTHER_LABEL_KEY || key === NO_LABEL_KEY) return { name: t('orgCanvas.legendFlow.other'), flow: false, color: '', icon: '' }
      const label = data.labels.find((l) => labelKeyOf(l) === key)
      if (!label) return { name: key, flow: false, color: '', icon: '' }
      return { name: label.name, flow: Boolean(label.flow_id), color: label.color || '', icon: label.icon || '' }
    }
    for (const path of flat.paths) {
      const a = anchor(path.source)
      const b = anchor(path.target)
      if (!a || !b) continue
      const style = MODE_STYLE[path.mode]
      const flowPath = data.paths.find((p) => p.source === path.source && p.target === path.target)
      const from = byId.get(path.source)
      const to = byId.get(path.target)
      const route = from && to ? `${names.node(from)} → ${names.node(to)}` : ''
      // Same takeoff and landing; each strip rises a step higher so the colors fan apart.
      const riseStep = Math.max(9, 42 / Math.max(1, path.strips.length))
      path.strips.forEach((strip, i) => {
        const flatPoints = arcPoints(a, b, { rise: i * riseStep })
        const points: THREE.Vector3[] = []
        for (let k = 0; k < flatPoints.length; k += 3) points.push(new THREE.Vector3(flatPoints[k], flatPoints[k + 1], flatPoints[k + 2]))
        const line = makeArc(
          flatPoints,
          { color: strip.color, width: strip.width, dash: strip.dash, opacity: lens === 'labels' ? 0.9 : style.opacity },
          resolution,
        )
        const count =
          strip.labelKey === OTHER_LABEL_KEY && flowPath
            ? otherLabelCount(flowPath.by_label, data.labels)
            : strip.labelKey && flowPath
              ? (flowPath.by_label[strip.labelKey] ?? 0)
              : path.count
        scene.add(line)
        arcs.push({
          line,
          pathId: path.id,
          labelKey: strip.labelKey,
          points,
          title: strip.labelKey ? pillFor(strip.labelKey)?.name ?? '' : t(`orgCanvas.mode.${path.mode}`),
          detail: `${route} · ${t('orgCanvas.node.conversations', { count })}`,
          pill: pillFor(strip.labelKey),
        })
      })
    }
    const replyAt = anchor('result:reply')
    const knowledgeAt = anchor('result:knowledge')
    if (replyAt && knowledgeAt && data.paths.some((p) => p.source === 'result:reply' && p.target === 'result:knowledge')) {
      const flatPoints = arcPoints(replyAt, knowledgeAt, { lift: 10 })
      const points: THREE.Vector3[] = []
      for (let k = 0; k < flatPoints.length; k += 3) points.push(new THREE.Vector3(flatPoints[k], flatPoints[k + 1], flatPoints[k + 2]))
      const line = makeArc(flatPoints, { color: '#8A8A88', width: 1.5, dash: '3 5', opacity: 1 }, resolution)
      scene.add(line)
      arcs.push({
        line,
        pathId: 'result:reply->result:knowledge',
        labelKey: null,
        points,
        title: t('orgCanvas.result.knowledge'),
        detail: t('orgCanvas.result.knowledgeSub'),
        pill: null,
      })
    }

    // Camera: fit the whole organization; zooming out stops when it all fits.
    const controls = new CameraControls(camera, renderer.domElement)
    controls.mouseButtons.left = CameraControls.ACTION.TRUCK
    controls.mouseButtons.right = CameraControls.ACTION.ROTATE
    controls.mouseButtons.wheel = CameraControls.ACTION.ZOOM
    controls.touches.one = CameraControls.ACTION.TOUCH_TRUCK
    controls.touches.two = CameraControls.ACTION.TOUCH_DOLLY_TRUCK
    controls.minPolarAngle = Math.PI * 0.12
    controls.maxPolarAngle = Math.PI * 0.42
    controls.dollyToCursor = true
    controls.smoothTime = 0.05
    const lookAt: [number, number, number, number, number, number] = [cx + 300, 330, cz + 860, cx, 0, cz]
    controls.setLookAt(...lookAt, false)
    controls.update(0)
    camera.updateMatrixWorld()
    // Fit the plates themselves at this angle, with room for the chips above them.
    const { minX, maxX, minZ, maxZ } = layout.bounds
    let ndcX = 0
    let ndcY = 0
    for (const [x, z] of [[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]]) {
      for (const y of [-SLAB_HEIGHT, 60]) {
        const v = new THREE.Vector3(x * SCALE, y, z * SCALE).project(camera)
        ndcX = Math.max(ndcX, Math.abs(v.x))
        ndcY = Math.max(ndcY, Math.abs(v.y))
      }
    }
    // Fit frame, then open a step closer — narrower plates leave room for detail.
    const fit = (camera.zoom * 1.02) / Math.max(ndcX, ndcY, 0.01)
    const homeZoom = fit * 1.12
    controls.minZoom = fit * 0.6
    controls.maxZoom = ZOOM_MAX
    homeRef.current = { lookAt, zoom: homeZoom }
    controls.zoomTo(homeZoom, false)
    const boundary = new THREE.Box3(new THREE.Vector3(cx - span, -40, cz - span), new THREE.Vector3(cx + span, 40, cz + span))
    controls.setBoundary(boundary)
    controlsRef.current = controls
    if (zoomApiRef) {
      zoomApiRef.current = {
        zoomBy(factor) {
          const current = controlsRef.current
          if (!current) return
          const cam = current.camera as THREE.OrthographicCamera
          void current.zoomTo(Math.min(current.maxZoom, Math.max(current.minZoom, cam.zoom * factor)), true)
        },
        reset() {
          const home = homeRef.current
          const current = controlsRef.current
          if (!home || !current) return
          void current.setLookAt(...home.lookAt, true)
          void current.zoomTo(home.zoom, true)
        },
      }
    }

    const tipTitle = document.createElement('span')
    tipTitle.style.cssText = 'display:block;font-weight:600'
    const tipPill = document.createElement('div')
    tipPill.style.cssText = 'display:none;margin-bottom:4px'
    const tipRoot: Root = createRoot(tipPill)
    let pillShown = ''
    const tipDetail = document.createElement('span')
    tipDetail.style.cssText = 'display:block;margin-top:1px;font-weight:500;font-size:10px;line-height:13px;opacity:0.75'
    const tipEl = document.createElement('div')
    tipEl.style.cssText = [
      'pointer-events:none',
      'padding:4px 8px',
      'border-radius:8px',
      `border:1px solid ${palette.labelBorder}`,
      `background:${palette.labelBg}`,
      `color:${palette.labelFg}`,
      'font:600 11px/14px var(--font-sans), system-ui, sans-serif',
      'white-space:nowrap',
      'box-shadow:0 2px 8px rgb(0 0 0 / 0.28)',
    ].join(';')
    tipEl.append(tipPill, tipTitle, tipDetail)
    const tip = new CSS2DObject(tipEl)
    tip.center.set(0.5, 1)
    tip.visible = false
    scene.add(tip)
    let hotLine: Line2 | null = null
    const hideTip = () => {
      tip.visible = false
      hotLine = null
    }

    // Picking: hover and click on pucks and columns (chips handle themselves).
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    let down: { x: number; y: number } | null = null
    let hovered: string | null = null
    const pick = (event: PointerEvent): string | null => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster.intersectObjects(pickables, false)[0]
      return (hit?.object.userData.nodeId as string | undefined) ?? null
    }
    const onPointerMove = (event: PointerEvent) => {
      if (down) return
      const id = pick(event)
      if (id) hideTip()
      if (id !== hovered) {
        hovered = id
        handlersRef.current.onHover(id)
      }
      if (id) {
        renderer.domElement.style.cursor = 'pointer'
        return
      }
      const rect = renderer.domElement.getBoundingClientRect()
      const mx = event.clientX - rect.left
      const my = event.clientY - rect.top
      let best: { dist: number; point: THREE.Vector3; title: string; detail: string; line: Line2; pill: (typeof arcs)[number]['pill'] } | null = null
      for (const arc of arcs) {
        const hit = closestOnArc(arc.points, mx, my, camera, rect.width, rect.height)
        if (!best || hit.dist < best.dist) best = { ...hit, title: arc.title, detail: arc.detail, line: arc.line, pill: arc.pill }
      }
      if (best && best.dist <= ARC_HIT_PX) {
        if (best.pill) {
          tipTitle.style.display = 'none'
          tipPill.style.display = 'block'
          const key = `${best.pill.flow}:${best.pill.name}:${best.pill.color}:${best.pill.icon}`
          if (key !== pillShown) {
            pillShown = key
            tipRoot.render(
              <TagPill
                names={best.pill.name}
                tone={best.pill.flow ? 'action' : 'free'}
                color={(best.pill.color || '') as LabelColor}
                icon={best.pill.icon || undefined}
                size="sm"
              />,
            )
          }
        } else {
          tipPill.style.display = 'none'
          tipTitle.style.display = 'block'
          tipTitle.textContent = best.title
        }
        tipDetail.textContent = best.detail
        tip.position.copy(best.point)
        tip.position.y += 8
        tip.visible = true
        hotLine = best.line
        renderer.domElement.style.cursor = 'pointer'
        return
      }
      hideTip()
      renderer.domElement.style.cursor = ''
    }
    const onPointerDown = (event: PointerEvent) => {
      down = { x: event.clientX, y: event.clientY }
    }
    const onPointerUp = (event: PointerEvent) => {
      const start = down
      down = null
      if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) return
      const id = pick(event)
      if (id) handlersRef.current.onSelect(id)
    }
    const onPointerLeave = () => {
      down = null
      hideTip()
      if (hovered) handlersRef.current.onHover(null)
      hovered = null
      renderer.domElement.style.cursor = ''
    }
    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointerup', onPointerUp)
    renderer.domElement.addEventListener('pointerleave', onPointerLeave)

    const clock = new THREE.Clock()
    let frame = 0
    let zoomShown = 0
    const tick = () => {
      frame = requestAnimationFrame(tick)
      controls.update(clock.getDelta())
      const pct = Math.round((camera.zoom / fit) * 100)
      if (pct !== zoomShown) {
        zoomShown = pct
        onZoomPctRef.current?.(pct)
      }
      const { lit, selectedId: selected } = stateRef.current
      for (const mark of marks) {
        const on = isLit(lit.litNodes, mark.node.id)
        const want = on ? 1 : DIM
        for (const mat of mark.materials) {
          const base = Number(mat.userData.baseOpacity) || 1
          mat.opacity += (base * want - mat.opacity) * LERP
        }
        mark.chip.style.opacity = String(on ? 1 : 0.35)
      }
      for (const arc of arcs) {
        const on = isLit(lit.litPaths, arc.pathId) && (lit.label === null || arc.labelKey === lit.label)
        const base = Number(arc.line.userData.baseOpacity) || 0.85
        setArcOpacity(arc.line, arc.line === hotLine ? 1 : on ? base : DIM * 0.6)
      }
      renderer.render(scene, camera)
      labelRenderer.render(scene, camera)
      declutterChips(slots, camera, host.clientWidth, host.clientHeight)
    }
    const slots = marks.map((m) => m.slot)
    tick()

    const onResize = () => {
      const w = host.clientWidth || 800
      const h = host.clientHeight || 600
      camera.left = (-frustum * (w / h)) / 2
      camera.right = (frustum * (w / h)) / 2
      camera.top = frustum / 2
      camera.bottom = -frustum / 2
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
      labelRenderer.setSize(w, h)
      resolution.set(w, h)
      for (const arc of arcs) (arc.line.material as { resolution: THREE.Vector2 }).resolution.set(w, h)
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(host)

    return () => {
      tipRoot.unmount()
      for (const face of faces) face.unmount()
      cancelAnimationFrame(frame)
      ro.disconnect()
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave)
      controls.dispose()
      controlsRef.current = null
      if (zoomApiRef) zoomApiRef.current = null
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (mesh.geometry) mesh.geometry.dispose()
        const mat = mesh.material
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
        else if (mat) mat.dispose()
      })
      renderer.dispose()
      if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement)
      if (labelRenderer.domElement.parentElement === host) host.removeChild(labelRenderer.domElement)
    }
  }, [data, lens, isDark, t, names])

  return (
    <div className={`relative h-full min-h-0 w-full ${isDark ? 'bg-[#141418]' : 'bg-[#d4d0ca]'}`} data-testid="grid-3d">
      <div ref={hostRef} className="absolute inset-0 z-0 touch-none" />
    </div>
  )
}

export default OrgFlowScene
