import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as THREE from 'three'
import CameraControls from 'camera-controls'
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import type { Line2 } from 'three/addons/lines/Line2.js'
import { useTheme } from '../../context/ThemeContext'
import type { OrgFlow, OrgFlowNode } from '../../lib/org-flow-api'
import {
  MODE_STYLE,
  columnHeight,
  emphasis,
  isLit,
  layoutOrgFlow2D,
  layoutOrgFlow3D,
  openStack,
  type Emphasis,
  type GridLens,
} from '../../lib/org-flow-layout'
import { arcPoints, makeArc, setArcOpacity } from './org3d/arcs'
import { declutterChips, makeNodeChip, makeTitle, type ChipSlot } from './org3d/labels'
import { makeColumn, makePlate, makePuck, makeRing, makeWorksInCubes, makeZone, materialsOf } from './org3d/plates'
import { makeSoftGrid, makeStageFloor, themePalette } from './org3d/stage'
import { useGridNames } from './org-flow-names'

CameraControls.install({ THREE })

type Props = {
  data: OrgFlow
  lens: GridLens
  label: string | null
  selectedId: string | null
  hoverId: string | null
  onHover: (id: string | null) => void
  onSelect: (id: string) => void
}

/** Layout units are 2D pixels; the scene keeps them so widths and dashes match. */
const SCALE = 40
const COLUMN_UNIT = 14
const ZOOM_MAX = 3
const LERP = 0.2
const DIM = 0.16

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

const PLATE_TINT: Record<string, number> = { input: 0x1e2a3d, executor: 0x1f2433, work: 0x2a1f27, result: 0x232a24 }
const PLATE_TINT_LIGHT: Record<string, number> = { input: 0xc9d6ea, executor: 0xcdd3e6, work: 0xe6d3dd, result: 0xd3e2d6 }

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
  ring: THREE.Mesh
  ghost: boolean
}

/** Grid in 3D: four plates in the 2D order, Result bent back as a horseshoe next to Intake. */
export function OrgFlowScene({ data, lens, label, selectedId, hoverId, onHover, onSelect }: Props) {
  const { t } = useTranslation('nav')
  const names = useGridNames()
  const { isDark } = useTheme()
  const hostRef = useRef<HTMLDivElement>(null)
  const controlsRef = useRef<CameraControls | null>(null)
  const homeRef = useRef<{ lookAt: [number, number, number, number, number, number]; zoom: number } | null>(null)
  const [zoomPct, setZoomPct] = useState(100)
  const stateRef = useRef<{ lit: Emphasis; selectedId: string | null }>({ lit: emphasis(data, lens, { label }), selectedId })
  stateRef.current = { lit: emphasis(data, lens, { focus: hoverId, label }), selectedId }
  const handlersRef = useRef({ onHover, onSelect })
  handlersRef.current = { onHover, onSelect }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const palette = themePalette(isDark)
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(palette.wash)

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

    const floor = makeStageFloor(Math.max(5200, span * 4), palette.ground, palette.groundEdge)
    floor.position.x = cx
    floor.position.z = cz
    scene.add(floor)
    const grid = makeSoftGrid(Math.max(2800, span * 2.2), 120, palette.gridMajor, palette.gridMinor, palette.gridOpacity)
    grid.position.x = cx
    grid.position.z = cz
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
      const tint = (isDark ? PLATE_TINT : PLATE_TINT_LIGHT)[plate.layer] ?? palette.floor
      scene.add(makePlate(points, tint, isDark ? 0.75 : 0.85))
      const [text, sub] = columnTitles[plate.layer] ?? ['', '']
      const title = makeTitle(text, sub, titleColor)
      const anchor = plate.layer === 'result' ? points[Math.floor(points.length / 4)] : points[0]
      title.position.set(anchor[0], 2, anchor[1] - 6)
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
    const zoneName = (id: string) => (id === 'none' ? t('orgCanvas.zone.none') : (zoneInfo.get(id)?.label ?? ''))
    for (const pos of layout.nodes) {
      const node = byId.get(pos.nodeId)
      if (!node) continue
      const group = new THREE.Group()
      group.position.set(pos.x * SCALE, 0, pos.z * SCALE)
      const radius = radiusOf(node)
      const autonomyColor =
        lens === 'autonomy' && node.autonomy ? new THREE.Color(MODE_STYLE[node.autonomy].color).getHex() : null
      const color = autonomyColor ?? KIND_HEX[node.kind] ?? 0x94a3b8
      const puck = makePuck(color, radius, 4, pos.ghost ? 0.35 : 1)
      puck.userData.nodeId = node.id
      group.add(puck)
      pickables.push(puck)
      let top = 5
      if (!pos.ghost && node.layer === 'executor' && node.open > 0) {
        const total = columnHeight(node.open) * COLUMN_UNIT
        const overloaded = node.issues.includes('overloaded')
        const segments =
          lens === 'labels'
            ? openStack(node, data.labels).map((s) => ({ height: (s.count / node.open) * total, color: s.color }))
            : [{ height: total, color: overloaded ? 0xeca530 : color }]
        const column = makeColumn(segments, 3.2, 5)
        column.traverse((c) => {
          if ((c as THREE.Mesh).isMesh) {
            c.userData.nodeId = node.id
            pickables.push(c)
          }
        })
        group.add(column)
        top += total + 2
      }
      if (node.kind === 'folder' && node.works_in?.length) group.add(makeWorksInCubes(node.works_in, radius, 5))
      const ring = makeRing(radius, 0xeca530)
      group.add(ring)
      if (node.issues.length && !pos.ghost) ring.userData.flagged = true

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
      const chip = makeNodeChip(
        {
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
      const slot: ChipSlot = { object: chip.object, el: chip.el, priority: (pos.ghost ? 0 : 1_000_000) + node.count + node.open }
      const mark: Mark = { node, group, materials: materialsOf(group), chip: chip.el, slot, ring, ghost: pos.ghost }
      marks.push(mark)
      if (!pos.ghost) markById.set(node.id, mark)
    }

    // Arcs: same strips, widths and dashes as 2D.
    const arcs: Array<{ line: Line2; pathId: string; labelKey: string | null }> = []
    const anchor = (id: string) => {
      const mark = markById.get(id)
      return mark ? mark.group.position.clone().add(new THREE.Vector3(0, 6, 0)) : null
    }
    for (const path of flat.paths) {
      const a = anchor(path.source)
      const b = anchor(path.target)
      if (!a || !b) continue
      const style = MODE_STYLE[path.mode]
      let offset = -path.width / 2
      for (const strip of path.strips) {
        const points = arcPoints(a, b, { offset: offset + strip.width / 2 })
        offset += strip.width
        const line = makeArc(
          points,
          { color: strip.color, width: strip.width, dash: strip.dash, opacity: lens === 'labels' ? 0.9 : style.opacity },
          resolution,
        )
        scene.add(line)
        arcs.push({ line, pathId: path.id, labelKey: strip.labelKey })
      }
    }
    const replyAt = anchor('result:reply')
    const knowledgeAt = anchor('result:knowledge')
    if (replyAt && knowledgeAt && data.paths.some((p) => p.source === 'result:reply' && p.target === 'result:knowledge')) {
      const line = makeArc(arcPoints(replyAt, knowledgeAt, { lift: 10 }), { color: '#8A8A88', width: 1.5, dash: '3 5', opacity: 1 }, resolution)
      scene.add(line)
      arcs.push({ line, pathId: 'result:reply->result:knowledge', labelKey: null })
    }

    // Camera: fit the whole organization; zooming out stops when it all fits.
    const controls = new CameraControls(camera, renderer.domElement)
    controls.mouseButtons.left = CameraControls.ACTION.TRUCK
    controls.mouseButtons.right = CameraControls.ACTION.ROTATE
    controls.mouseButtons.wheel = CameraControls.ACTION.ZOOM
    controls.touches.one = CameraControls.ACTION.TOUCH_TRUCK
    controls.touches.two = CameraControls.ACTION.TOUCH_DOLLY_TRUCK
    controls.minPolarAngle = Math.PI * 0.12
    controls.maxPolarAngle = Math.PI * 0.36
    controls.dollyToCursor = true
    controls.smoothTime = 0.05
    const fit = (frustum * Math.min(width / height, 1)) / (span * 0.95)
    controls.minZoom = fit * 0.8
    controls.maxZoom = ZOOM_MAX
    const lookAt: [number, number, number, number, number, number] = [cx + 500, 700, cz + 700, cx, 0, cz]
    homeRef.current = { lookAt, zoom: fit }
    controls.setLookAt(...lookAt, false)
    controls.zoomTo(fit, false)
    const boundary = new THREE.Box3(new THREE.Vector3(cx - span, -40, cz - span), new THREE.Vector3(cx + span, 40, cz + span))
    controls.setBoundary(boundary)
    controlsRef.current = controls

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
      if (id !== hovered) {
        hovered = id
        handlersRef.current.onHover(id)
        renderer.domElement.style.cursor = id ? 'pointer' : ''
      }
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
      if (hovered) handlersRef.current.onHover(null)
      hovered = null
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
        setZoomPct(pct)
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
        const ringMat = mark.ring.material as THREE.MeshBasicMaterial
        const isSelected = selected === mark.node.id && !mark.ghost
        ringMat.color.setHex(isSelected ? palette.ring : 0xeca530)
        const ringWant = isSelected ? 0.9 : mark.ring.userData.flagged ? 0.55 * want : 0
        ringMat.opacity += (ringWant - ringMat.opacity) * LERP
      }
      for (const arc of arcs) {
        const on = isLit(lit.litPaths, arc.pathId) && (lit.label === null || arc.labelKey === lit.label)
        const base = Number(arc.line.userData.baseOpacity) || 0.85
        setArcOpacity(arc.line, on ? base : DIM * 0.6)
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
      cancelAnimationFrame(frame)
      ro.disconnect()
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave)
      controls.dispose()
      controlsRef.current = null
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

  const zoomBy = (factor: number) => {
    const controls = controlsRef.current
    if (!controls) return
    const camera = controls.camera as THREE.OrthographicCamera
    void controls.zoomTo(Math.min(controls.maxZoom, Math.max(controls.minZoom, camera.zoom * factor)), true)
  }

  return (
    <div className={`relative h-full min-h-0 w-full ${isDark ? 'bg-[#141418]' : 'bg-[#d4d0ca]'}`} data-testid="grid-3d">
      <div ref={hostRef} className="absolute inset-0 touch-none" />
      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-3">
        <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-border/40 bg-bg-surface/75 px-1.5 py-1 shadow-sm backdrop-blur-sm">
          <button type="button" className="rounded-full px-2.5 py-1 text-xs text-text-muted hover:bg-bg-elevated hover:text-text-heading" onClick={() => zoomBy(1 / 1.15)}>
            -
          </button>
          <span className="min-w-[3rem] text-center text-[11px] tabular-nums text-text-muted">{zoomPct}%</span>
          <button type="button" className="rounded-full px-2.5 py-1 text-xs text-text-muted hover:bg-bg-elevated hover:text-text-heading" onClick={() => zoomBy(1.15)}>
            +
          </button>
          <button
            type="button"
            className="rounded-full px-2.5 py-1 text-xs text-text-muted hover:bg-bg-elevated hover:text-text-heading"
            onClick={() => {
              const home = homeRef.current
              const controls = controlsRef.current
              if (!home || !controls) return
              void controls.setLookAt(...home.lookAt, true)
              void controls.zoomTo(home.zoom, true)
            }}
          >
            {t('orgCanvas.reset')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default OrgFlowScene
