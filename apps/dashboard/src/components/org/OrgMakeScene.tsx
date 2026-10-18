import { useEffect, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import * as THREE from 'three'
import CameraControls from 'camera-controls'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { CSS3DObject, CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js'
import { useTheme } from '../../context/ThemeContext'
import type { OrgGraph, OrgGraphNode } from '../../lib/teams-api'
import { OrgNodeFace } from './OrgNodeFace'

CameraControls.install({ THREE })

/** Standing marks (people / agents / company): screen-space pop. */
const STAND_HOVER_LIFT_PX = 10
/** Flat marks: camera-facing billboard lift on hover (CSS2D). */
const FLAT_HOVER_LIFT_PX = 14
const HOVER_SCALE = 1.1
const LERP = 0.2
/** Name chips appear once the camera is this zoomed in (also on hover). */
const LABEL_ZOOM = 1.05

const KIND_HEX: Record<string, number> = {
  organization: 0x34d399,
  department: 0x60a5fa,
  user: 0x2dd4bf,
  agent: 0xa78bfa,
  channel: 0x38bdf8,
  flow: 0xf472b6,
  label: 0xfbbf24,
  folder: 0xf59e0b,
  calendar: 0x818cf8,
  connection: 0x94a3b8,
  module: 0xc084fc,
  doc: 0xcbd5e1,
  source: 0x86efac,
  webhook: 0xf87171,
}

type ScenePalette = {
  wash: number
  ground: number
  gridMajor: number
  gridMinor: number
  gridOpacity: number
  floor: number
  floorOpacity: number
  areaTint: number
  edge: number
  ring: number
  faceBg: string
  labelBorder: string
  labelBg: string
  labelFg: string
  ambient: number
  ambientIntensity: number
  keyIntensity: number
  fill: number
  fillIntensity: number
  fogNear: number
  fogFar: number
  emissiveIntensity: number
  sideScale: number
  dimOpacity: number
  edgeRest: number
  edgeDim: number
}

function cssRgbTuple(token: string): [number, number, number] {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim()
  const parts = raw.split(/\s+/).map((part) => Number(part))
  if (parts.length >= 3 && parts.every((n) => Number.isFinite(n))) {
    return [parts[0], parts[1], parts[2]]
  }
  return [18, 18, 19]
}

function cssRgbHex(token: string): number {
  const [r, g, b] = cssRgbTuple(token)
  return (r << 16) + (g << 8) + b
}

function themePalette(isDark: boolean): ScenePalette {
  const accent = cssRgbHex('--color-accent')
  if (isDark) {
    return {
      wash: 0x121213,
      ground: 0x151516,
      gridMajor: 0x26262a,
      gridMinor: 0x1e1e22,
      gridOpacity: 0.22,
      floor: 0x1c1c20,
      floorOpacity: 0.22,
      areaTint: 0x3b82f6,
      edge: accent,
      ring: accent,
      faceBg: '#1a1a1c',
      labelBorder: 'rgb(50 50 56 / 0.7)',
      labelBg: 'rgb(22 22 24 / 0.82)',
      labelFg: '#f4f4f2',
      ambient: 0xd4d4d8,
      ambientIntensity: 0.95,
      keyIntensity: 1.0,
      fill: 0x3f3f46,
      fillIntensity: 0.2,
      fogNear: 2600,
      fogFar: 5200,
      emissiveIntensity: 0.05,
      sideScale: 0.48,
      dimOpacity: 0.72,
      edgeRest: 0.22,
      edgeDim: 0.08,
    }
  }
  // Paper-white stage: almost no fog, whisper grid, soft blue area wash.
  return {
    wash: 0xffffff,
    ground: 0xffffff,
    gridMajor: 0xeef0f2,
    gridMinor: 0xf5f6f7,
    gridOpacity: 0.28,
    floor: 0xf3f6fb,
    floorOpacity: 0.55,
    areaTint: 0x93c5fd,
    edge: accent,
    ring: accent,
    faceBg: '#ffffff',
    labelBorder: 'rgb(226 232 240 / 0.95)',
    labelBg: 'rgb(255 255 255 / 0.92)',
    labelFg: '#0f172a',
    ambient: 0xffffff,
    ambientIntensity: 1.35,
    keyIntensity: 0.35,
    fill: 0xffffff,
    fillIntensity: 0.35,
    fogNear: 8000,
    fogFar: 14000,
    emissiveIntensity: 0.01,
    sideScale: 0.78,
    dimOpacity: 0.82,
    edgeRest: 0.28,
    edgeDim: 0.1,
  }
}

type Props = {
  graph: OrgGraph
  linkedIds: Set<string>
  onOpenNode: (node: OrgGraphNode) => void
  focusNodeId?: string | null
  onFocused?: () => void
  kindLabel: (kind: string) => string
  openHint: string
}

function puckRadius(kind: string): number {
  if (kind === 'organization') return 16
  return 9
}

function puckHeight(kind: string): number {
  if (kind === 'organization') return 4.5
  return 3.2
}

function markSize(kind: string): number {
  if (kind === 'organization') return 44
  if (kind === 'department') return 40
  if (kind === 'agent' || kind === 'user') return 36
  return 30
}

/** People, agents and company logo: upright billboards. Everything else: flat on the pad. */
function markAlwaysStanding(kind: string): boolean {
  return kind === 'organization' || kind === 'user' || kind === 'agent'
}

/** Soft disc behind logos/icons (AgentMark already has its own orb). */
function markNeedsDisc(kind: string): boolean {
  return kind !== 'user' && kind !== 'agent'
}

function makeFloor(points: number[][], palette: ScenePalette, tintIndex: number): THREE.Mesh {
  const shape = new THREE.Shape()
  const first = points[0]
  shape.moveTo(first[0], -first[1])
  for (let i = 1; i < points.length; i += 1) {
    shape.lineTo(points[i][0], -points[i][1])
  }
  shape.closePath()
  const geo = new THREE.ShapeGeometry(shape)
  geo.rotateX(-Math.PI / 2)
  const base = new THREE.Color(palette.floor)
  const tint = new THREE.Color(palette.areaTint)
  // Rotate hue slightly per department so islands feel distinct without loud color.
  tint.offsetHSL((tintIndex % 6) * 0.08, 0, 0)
  base.lerp(tint, 0.35)
  const mat = new THREE.MeshStandardMaterial({
    color: base,
    transparent: true,
    opacity: palette.floorOpacity,
    roughness: 1,
    metalness: 0,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.y = 0.15
  mesh.receiveShadow = true
  return mesh
}

function makeAreaLabel(
  text: string,
  palette: ScenePalette,
  onOpen: () => void,
): CSS2DObject {
  const wrap = document.createElement('div')
  wrap.style.pointerEvents = 'auto'
  wrap.style.cursor = 'pointer'
  wrap.addEventListener('click', (event) => {
    event.stopPropagation()
    onOpen()
  })
  const chip = document.createElement('div')
  chip.textContent = text
  chip.style.padding = '4px 10px'
  chip.style.borderRadius = '9999px'
  chip.style.fontSize = '11px'
  chip.style.fontWeight = '600'
  chip.style.letterSpacing = '0.01em'
  chip.style.whiteSpace = 'nowrap'
  chip.style.background = palette.labelBg
  chip.style.color = palette.labelFg
  chip.style.border = `1px solid ${palette.labelBorder}`
  chip.style.backdropFilter = 'blur(10px)'
  chip.style.boxShadow = '0 1px 2px rgb(0 0 0 / 0.06)'
  wrap.append(chip)
  const object = new CSS2DObject(wrap)
  object.center.set(0.5, 0.5)
  return object
}

function makePuck(node: OrgGraphNode, palette: ScenePalette): THREE.Group {
  const group = new THREE.Group()
  group.userData = { nodeId: node.id, href: node.href, label: node.label, kind: node.kind }
  const r = puckRadius(node.kind)
  const h = puckHeight(node.kind)
  const hex = KIND_HEX[node.kind] ?? 0x94a3b8
  const topColor = new THREE.Color(hex).lerp(new THREE.Color(palette.ground), 0.28)
  const side = new THREE.MeshStandardMaterial({
    color: topColor.clone().multiplyScalar(palette.sideScale),
    roughness: 0.7,
    metalness: 0.06,
  })
  const top = new THREE.MeshStandardMaterial({
    color: topColor,
    roughness: 0.55,
    metalness: 0.08,
    emissive: hex,
    emissiveIntensity: palette.emissiveIntensity,
  })
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.92, h, 28), top)
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.position.y = h / 2
  group.add(mesh)

  const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.02, r * 1.02, h * 0.35, 28), side)
  rim.position.y = h * 0.18
  rim.castShadow = true
  group.add(rim)

  const halo = new THREE.Mesh(
    new THREE.RingGeometry(r * 1.15, r * 1.55, 48),
    new THREE.MeshBasicMaterial({
      color: palette.ring,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  )
  halo.rotation.x = -Math.PI / 2
  halo.position.y = 0.35
  group.add(halo)

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(r * 1.1, 32),
    new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.06,
      depthWrite: false,
    }),
  )
  shadow.rotation.x = -Math.PI / 2
  shadow.position.y = 0.12
  group.add(shadow)

  group.userData.platformH = h
  group.userData.platformR = r
  group.userData.topMat = top
  group.userData.sideMats = [side]
  group.userData.baseEmissive = palette.emissiveIntensity
  group.userData.halo = halo
  group.userData.shadow = shadow
  group.userData.hover = 0
  group.userData.hoverTarget = 0
  group.userData.focusBlend = 1
  group.position.set(node.x, 0, node.y)
  return group
}

function makeEdge(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  opacity: number,
  palette: ScenePalette,
  sourceId: string,
  targetId: string,
): THREE.Line {
  const midLift = 2.5
  const curve = new THREE.CubicBezierCurve3(
    new THREE.Vector3(ax, 3, az),
    new THREE.Vector3(ax + (bx - ax) * 0.35, 3 + midLift, az + (bz - az) * 0.35),
    new THREE.Vector3(ax + (bx - ax) * 0.65, 3 + midLift, az + (bz - az) * 0.65),
    new THREE.Vector3(bx, 3, bz),
  )
  const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(16))
  const mat = new THREE.LineBasicMaterial({ color: palette.edge, transparent: true, opacity })
  const line = new THREE.Line(geo, mat)
  line.userData = { sourceId, targetId, baseOpacity: opacity }
  return line
}

function markCssPx(kind: string): number {
  const size = markSize(kind)
  return markNeedsDisc(kind) ? Math.round(size * 1.35) : size
}

function buildMarkDom(
  node: OrgGraphNode,
  palette: ScenePalette,
  onOpen: (node: OrgGraphNode) => void,
  onHover: (node: OrgGraphNode | null, clientX: number, clientY: number) => void,
): { wrap: HTMLDivElement; faceEl: HTMLDivElement; root: Root; cssPx: number } {
  const size = markSize(node.kind)
  const cssPx = markCssPx(node.kind)
  const wrap = document.createElement('div')
  wrap.style.pointerEvents = 'auto'
  wrap.style.cursor = 'pointer'
  wrap.addEventListener('click', (event) => {
    event.stopPropagation()
    onOpen(node)
  })
  wrap.addEventListener('pointerenter', (event) => onHover(node, event.clientX, event.clientY))
  wrap.addEventListener('pointermove', (event) => onHover(node, event.clientX, event.clientY))
  wrap.addEventListener('pointerleave', () => onHover(null, 0, 0))

  const faceEl = document.createElement('div')
  faceEl.dataset.deckFace = '1'
  faceEl.style.position = 'relative'
  faceEl.style.display = 'flex'
  faceEl.style.alignItems = 'center'
  faceEl.style.justifyContent = 'center'
  faceEl.style.width = `${cssPx}px`
  faceEl.style.height = `${cssPx}px`
  faceEl.style.willChange = 'transform, filter'
  faceEl.style.filter = 'drop-shadow(0 1px 2px rgb(0 0 0 / 0.2))'

  if (markNeedsDisc(node.kind)) {
    faceEl.style.borderRadius = '9999px'
    faceEl.style.background = palette.faceBg
    faceEl.style.border = `1px solid ${palette.labelBorder}`
    faceEl.style.boxShadow = '0 1px 3px rgb(0 0 0 / 0.14)'
  }

  const markHost = document.createElement('div')
  markHost.style.display = 'block'
  markHost.style.lineHeight = '0'
  faceEl.append(markHost)
  wrap.append(faceEl)

  const root = createRoot(markHost)
  root.render(<OrgNodeFace node={node} size={size} live={node.kind === 'agent'} />)
  return { wrap, faceEl, root, cssPx }
}

function tipMeta(node: OrgGraphNode, regionLabel?: string): string[] {
  const mark = node.mark ?? {}
  const bits: string[] = []
  if (mark.channel) bits.push(mark.channel)
  if (mark.provider) bits.push(mark.provider)
  if (regionLabel) bits.push(regionLabel)
  return bits
}

function mountNameChip(text: string, palette: ScenePalette): { object: CSS2DObject; el: HTMLElement } {
  const wrap = document.createElement('div')
  wrap.style.pointerEvents = 'none'
  const el = document.createElement('div')
  el.textContent = text
  el.style.padding = '2px 7px'
  el.style.borderRadius = '6px'
  el.style.fontSize = '11px'
  el.style.fontWeight = '600'
  el.style.lineHeight = '1.2'
  el.style.whiteSpace = 'nowrap'
  el.style.maxWidth = '140px'
  el.style.overflow = 'hidden'
  el.style.textOverflow = 'ellipsis'
  el.style.background = palette.labelBg
  el.style.color = palette.labelFg
  el.style.border = `1px solid ${palette.labelBorder}`
  el.style.backdropFilter = 'blur(8px)'
  el.style.boxShadow = '0 1px 2px rgb(0 0 0 / 0.08)'
  el.style.opacity = '0'
  el.style.transition = 'opacity 120ms ease'
  wrap.append(el)
  const object = new CSS2DObject(wrap)
  object.center.set(0.5, 1)
  return { object, el }
}

type DeckItem = {
  mode: 'stand' | 'flat'
  standObject?: CSS2DObject
  flatObject?: CSS3DObject
  /** Resting flat face (CSS3D). */
  faceEl: HTMLElement
  /** Hover billboard face (CSS2D); same as faceEl for always-standing marks. */
  standFaceEl: HTMLElement
  restY: number
  standRestY: number
  baseScale: number
}

type HoverTip = { node: OrgGraphNode; x: number; y: number }

/** Make Grid–style WebGL org map: 3D pucks, floors, camera-controls pan/zoom/orbit. */
export function OrgMakeScene({
  graph,
  linkedIds,
  onOpenNode,
  focusNodeId,
  onFocused,
  kindLabel,
  openHint,
}: Props) {
  const { isDark } = useTheme()
  const hostRef = useRef<HTMLDivElement>(null)
  const [zoomPct, setZoomPct] = useState(100)
  const [tip, setTip] = useState<HoverTip | null>(null)
  const controlsRef = useRef<CameraControls | null>(null)
  const focusApiRef = useRef<{ focus: (id: string) => void } | null>(null)
  const onOpenRef = useRef(onOpenNode)
  onOpenRef.current = onOpenNode
  const onFocusedRef = useRef(onFocused)
  onFocusedRef.current = onFocused

  useEffect(() => {
    if (!focusNodeId) return
    focusApiRef.current?.focus(focusNodeId)
    onFocusedRef.current?.()
  }, [focusNodeId])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const palette = themePalette(isDark)
    const reactRoots: Root[] = []

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(palette.wash)
    scene.fog = new THREE.Fog(palette.wash, palette.fogNear, palette.fogFar)

    const width = host.clientWidth || 800
    const height = host.clientHeight || 600
    const aspect = width / height
    const frustum = 420
    const camera = new THREE.OrthographicCamera(
      (-frustum * aspect) / 2,
      (frustum * aspect) / 2,
      frustum / 2,
      -frustum / 2,
      0.1,
      5000,
    )

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(width, height)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    host.appendChild(renderer.domElement)

    const standRenderer = new CSS2DRenderer()
    standRenderer.setSize(width, height)
    standRenderer.domElement.style.position = 'absolute'
    standRenderer.domElement.style.inset = '0'
    standRenderer.domElement.style.pointerEvents = 'none'
    standRenderer.domElement.style.overflow = 'hidden'
    host.appendChild(standRenderer.domElement)

    const flatRenderer = new CSS3DRenderer()
    flatRenderer.setSize(width, height)
    flatRenderer.domElement.style.position = 'absolute'
    flatRenderer.domElement.style.inset = '0'
    flatRenderer.domElement.style.pointerEvents = 'none'
    flatRenderer.domElement.style.overflow = 'hidden'
    host.appendChild(flatRenderer.domElement)

    const controls = new CameraControls(camera, renderer.domElement)
    controls.setLookAt(420, 480, 420, 0, 0, 0, false)
    controls.mouseButtons.left = CameraControls.ACTION.TRUCK
    controls.mouseButtons.right = CameraControls.ACTION.ROTATE
    controls.mouseButtons.middle = CameraControls.ACTION.DOLLY
    controls.mouseButtons.wheel = CameraControls.ACTION.ZOOM
    controls.touches.one = CameraControls.ACTION.TOUCH_TRUCK
    controls.touches.two = CameraControls.ACTION.TOUCH_DOLLY_TRUCK
    controls.minPolarAngle = Math.PI * 0.18
    controls.maxPolarAngle = Math.PI * 0.42
    controls.dollyToCursor = true
    controls.smoothTime = 0.05
    controls.draggingSmoothTime = 0.02
    controlsRef.current = controls

    scene.add(new THREE.AmbientLight(palette.ambient, palette.ambientIntensity))
    const key = new THREE.DirectionalLight(0xffffff, palette.keyIntensity)
    key.position.set(220, 420, 120)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.left = -700
    key.shadow.camera.right = 700
    key.shadow.camera.top = 700
    key.shadow.camera.bottom = -700
    scene.add(key)
    const fill = new THREE.DirectionalLight(palette.fill, palette.fillIntensity)
    fill.position.set(-260, 180, -200)
    scene.add(fill)

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000),
      new THREE.MeshStandardMaterial({ color: palette.ground, roughness: 1, metalness: 0 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = -0.5
    ground.receiveShadow = true
    scene.add(ground)

    const grid = new THREE.GridHelper(2400, 80, palette.gridMajor, palette.gridMinor)
    grid.position.y = 0.05
    ;(grid.material as THREE.Material).transparent = true
    ;(grid.material as THREE.Material).opacity = palette.gridOpacity
    scene.add(grid)

    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]))
    const puckById = new Map<string, THREE.Group>()
    const root = new THREE.Group()
    scene.add(root)

    const regionById = new Map((graph.regions ?? []).map((region) => [region.id, region]))
    ;(graph.regions ?? []).forEach((region, index) => {
      if (region.points.length < 3) return
      root.add(makeFloor(region.points, palette, index))
      if (region.labelAt) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(18, 20, 48),
          new THREE.MeshBasicMaterial({
            color: palette.ring,
            transparent: true,
            opacity: isDark ? 0.1 : 0.12,
            side: THREE.DoubleSide,
          }),
        )
        ring.rotation.x = -Math.PI / 2
        ring.position.set(region.labelAt[0], 0.25, region.labelAt[1])
        root.add(ring)
      }
    })

    // Full graph adjacency (including membership edges we don't draw) for hover focus.
    const neighbors = new Map<string, Set<string>>()
    for (const edge of graph.edges) {
      if (!linkedIds.has(edge.source) || !linkedIds.has(edge.target)) continue
      if (!neighbors.has(edge.source)) neighbors.set(edge.source, new Set())
      if (!neighbors.has(edge.target)) neighbors.set(edge.target, new Set())
      neighbors.get(edge.source)!.add(edge.target)
      neighbors.get(edge.target)!.add(edge.source)
    }

    const edgeLines: THREE.Line[] = []
    for (const edge of graph.edges) {
      const a = nodeById.get(edge.source)
      const b = nodeById.get(edge.target)
      if (!a || !b || !linkedIds.has(a.id) || !linkedIds.has(b.id)) continue
      // Membership is implied by the island; keep org spokes for the star layout.
      if ((a.kind === 'department' || b.kind === 'department') && edge.kind === 'member') continue
      const opacity =
        edge.kind === 'org' ? palette.edgeRest * 0.7 : edge.kind === 'member' ? palette.edgeRest : palette.edgeRest + 0.18
      const line = makeEdge(a.x, a.y, b.x, b.y, opacity, palette, a.id, b.id)
      edgeLines.push(line)
      root.add(line)
    }

    standRenderer.domElement.style.pointerEvents = 'none'
    flatRenderer.domElement.style.pointerEvents = 'none'

    let hovered: THREE.Group | null = null
    let focusIds = new Set<string>()
    const relatedOf = (nodeId: string): Set<string> => {
      const out = new Set<string>([nodeId])
      for (const other of neighbors.get(nodeId) ?? []) out.add(other)
      const node = nodeById.get(nodeId)
      // Department island: everyone filed on that area counts as direct.
      if (node?.kind === 'department') {
        for (const other of graph.nodes) {
          if (other.region === nodeId) out.add(other.id)
        }
      } else if (node?.region && node.region.startsWith('department:')) {
        out.add(node.region)
      }
      return out
    }
    const applyHover = (puck: THREE.Group | null, node: OrgGraphNode | null, clientX: number, clientY: number) => {
      if (hovered && hovered !== puck) hovered.userData.hoverTarget = 0
      hovered = puck
      if (hovered) hovered.userData.hoverTarget = 1
      focusIds = node ? relatedOf(node.id) : new Set()
      if (node) setTip({ node, x: clientX, y: clientY })
      else setTip(null)
    }

    for (const node of graph.nodes) {
      if (!linkedIds.has(node.id)) continue

      // Departments are the islands themselves — name chip on the area, no puck.
      if (node.kind === 'department') {
        const group = new THREE.Group()
        group.userData = { nodeId: node.id, href: node.href, label: node.label, kind: node.kind }
        group.position.set(node.x, 0, node.y)
        const hit = new THREE.Mesh(
          new THREE.CircleGeometry(26, 40),
          new THREE.MeshBasicMaterial({
            transparent: true,
            opacity: 0,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        )
        hit.rotation.x = -Math.PI / 2
        hit.position.y = 0.3
        group.add(hit)
        const region = regionById.get(node.id)
        const labelAt = region?.labelAt
        const label = makeAreaLabel(node.label, palette, () => onOpenRef.current(node))
        label.position.set(
          labelAt ? labelAt[0] - node.x : 0,
          1.2,
          labelAt ? labelAt[1] - node.y : 0,
        )
        group.add(label)
        group.userData.hover = 0
        group.userData.hoverTarget = 0
        group.userData.deck = []
        group.userData.isArea = true
        group.userData.areaLabelEl = label.element
        puckById.set(node.id, group)
        root.add(group)
        continue
      }

      const puck = makePuck(node, palette)
      puckById.set(node.id, puck)
      root.add(puck)

      const platformH = Number(puck.userData.platformH) || 4
      const platformR = Number(puck.userData.platformR) || 10
      const onMarkHover = (n: OrgGraphNode | null, clientX: number, clientY: number) => {
        if (!n) {
          applyHover(null, null, 0, 0)
          return
        }
        applyHover(puckById.get(n.id) ?? null, n, clientX, clientY)
      }
      const standing = markAlwaysStanding(node.kind)
      if (standing) {
        const { wrap, faceEl, root: markRoot } = buildMarkDom(
          node,
          palette,
          (n) => onOpenRef.current(n),
          onMarkHover,
        )
        faceEl.style.transformOrigin = '50% 100%'
        const object = new CSS2DObject(wrap)
        object.center.set(0.5, 1)
        const restY = platformH
        object.position.set(0, restY, 0)
        object.element.style.pointerEvents = 'auto'
        puck.add(object)
        puck.userData.deck = [
          {
            mode: 'stand',
            standObject: object,
            faceEl,
            standFaceEl: faceEl,
            restY,
            standRestY: restY,
            baseScale: 1,
          },
        ] satisfies DeckItem[]
        // Name rides with the standing mark in screen space (above the face).
        const nameEl = document.createElement('div')
        nameEl.textContent = node.label
        nameEl.style.position = 'absolute'
        nameEl.style.left = '50%'
        nameEl.style.bottom = '100%'
        nameEl.style.marginBottom = '6px'
        nameEl.style.transform = 'translateX(-50%)'
        nameEl.style.padding = '2px 7px'
        nameEl.style.borderRadius = '6px'
        nameEl.style.fontSize = '11px'
        nameEl.style.fontWeight = '600'
        nameEl.style.lineHeight = '1.2'
        nameEl.style.whiteSpace = 'nowrap'
        nameEl.style.maxWidth = '140px'
        nameEl.style.overflow = 'hidden'
        nameEl.style.textOverflow = 'ellipsis'
        nameEl.style.background = palette.labelBg
        nameEl.style.color = palette.labelFg
        nameEl.style.border = `1px solid ${palette.labelBorder}`
        nameEl.style.backdropFilter = 'blur(8px)'
        nameEl.style.boxShadow = '0 1px 2px rgb(0 0 0 / 0.08)'
        nameEl.style.opacity = '0'
        nameEl.style.transition = 'opacity 120ms ease'
        nameEl.style.pointerEvents = 'none'
        faceEl.style.position = 'relative'
        faceEl.append(nameEl)
        puck.userData.nameEl = nameEl
        reactRoots.push(markRoot)
      } else {
        const flatDom = buildMarkDom(node, palette, (n) => onOpenRef.current(n), onMarkHover)
        const standDom = buildMarkDom(node, palette, (n) => onOpenRef.current(n), onMarkHover)
        flatDom.faceEl.style.transformOrigin = '50% 50%'
        standDom.faceEl.style.transformOrigin = '50% 100%'

        const flatObject = new CSS3DObject(flatDom.wrap)
        flatObject.rotation.x = -Math.PI / 2
        const baseScale = (platformR * 1.45) / Math.max(flatDom.cssPx, 1)
        const restY = platformH + 0.35
        flatObject.position.set(0, restY, 0)
        flatObject.scale.setScalar(baseScale)
        flatObject.element.style.pointerEvents = 'auto'
        flatObject.element.style.opacity = '1'
        puck.add(flatObject)

        const standObject = new CSS2DObject(standDom.wrap)
        standObject.center.set(0.5, 1)
        const standRestY = platformH
        standObject.position.set(0, standRestY, 0)
        standObject.element.style.pointerEvents = 'none'
        standObject.element.style.opacity = '0'
        standObject.element.style.transition = 'opacity 120ms ease'
        puck.add(standObject)

        puck.userData.deck = [
          {
            mode: 'flat',
            flatObject,
            standObject,
            faceEl: flatDom.faceEl,
            standFaceEl: standDom.faceEl,
            restY,
            standRestY,
            baseScale,
          },
        ] satisfies DeckItem[]
        // Zoom/hover name as CSS2D above the pad (flat icons stay on the deck).
        const { object: nameObj, el: nameEl } = mountNameChip(node.label, palette)
        nameObj.position.set(0, platformH + 2.5, 0)
        puck.add(nameObj)
        puck.userData.nameEl = nameEl
        reactRoots.push(flatDom.root, standDom.root)
      }
    }

    const box = new THREE.Box3().setFromObject(root)
    if (!box.isEmpty()) {
      const size = box.getSize(new THREE.Vector3())
      const center = box.getCenter(new THREE.Vector3())
      const span = Math.max(size.x, size.z, 200)
      controls.setLookAt(
        center.x + span * 0.85,
        span * 0.95,
        center.z + span * 0.85,
        center.x,
        0,
        center.z,
        false,
      )
      controls.zoomTo(Math.min(2.4, Math.max(0.35, (frustum * 0.9) / span)), false)
    }

    let flashTimer: ReturnType<typeof setTimeout> | null = null
    focusApiRef.current = {
      focus: (id: string) => {
        const puck = puckById.get(id)
        if (!puck) return
        const x = puck.position.x
        const z = puck.position.z
        void controls.setLookAt(x + 160, 200, z + 160, x, 0, z, true)
        void controls.zoomTo(Math.min(2.2, Math.max(0.9, camera.zoom)), true)
        for (const other of puckById.values()) other.userData.hoverTarget = 0
        puck.userData.hoverTarget = 1
        if (flashTimer) clearTimeout(flashTimer)
        flashTimer = setTimeout(() => {
          if (puck.userData.hoverTarget === 1) puck.userData.hoverTarget = 0
        }, 1800)
      },
    }

    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    let pointerDown = new THREE.Vector2()
    let dragging = false

    const setHover = (next: THREE.Group | null, clientX: number, clientY: number) => {
      const node = next ? nodeById.get(String(next.userData.nodeId)) ?? null : null
      applyHover(next, node, clientX, clientY)
    }

    const pick = (clientX: number, clientY: number): THREE.Group | null => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const hits = raycaster.intersectObjects([...puckById.values()], true)
      if (!hits.length) return null
      let obj: THREE.Object3D | null = hits[0].object
      while (obj && !obj.userData?.nodeId) obj = obj.parent
      return (obj as THREE.Group) || null
    }

    const onPointerMove = (event: PointerEvent) => {
      if (Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 4) dragging = true
      const hit = pick(event.clientX, event.clientY)
      setHover(hit, event.clientX, event.clientY)
      renderer.domElement.style.cursor = hit ? 'pointer' : dragging ? 'grabbing' : 'grab'
    }
    const onPointerDown = (event: PointerEvent) => {
      pointerDown.set(event.clientX, event.clientY)
      dragging = false
      renderer.domElement.style.cursor = 'grabbing'
    }
    const onPointerUp = (event: PointerEvent) => {
      if (dragging || event.button !== 0) {
        dragging = false
        return
      }
      const hit = pick(event.clientX, event.clientY)
      if (!hit) return
      const node = nodeById.get(String(hit.userData.nodeId))
      if (node) onOpenRef.current(node)
    }
    const onPointerLeave = () => {
      setHover(null, 0, 0)
      renderer.domElement.style.cursor = 'grab'
    }

    renderer.domElement.addEventListener('pointermove', onPointerMove)
    renderer.domElement.addEventListener('pointerdown', onPointerDown)
    renderer.domElement.addEventListener('pointerup', onPointerUp)
    renderer.domElement.addEventListener('pointerleave', onPointerLeave)

    const clock = new THREE.Clock()
    let frame = 0
    let zoomShown = -1

    const tickHover = () => {
      const hoverId = hovered ? String(hovered.userData.nodeId) : ''
      const focusing = focusIds.size > 0
      for (const puck of puckById.values()) {
        const nodeId = String(puck.userData.nodeId)
        const inFocus = !focusing || focusIds.has(nodeId)
        const target = Number(puck.userData.hoverTarget) || 0
        let hover = Number(puck.userData.hover) || 0
        hover += (target - hover) * LERP
        if (Math.abs(hover - target) < 0.001) hover = target
        puck.userData.hover = hover

        // Unrelated items fade hard so the focus cluster pops.
        const focusAmt = focusing ? (inFocus ? 1 : 0) : 1
        let focusBlend = Number(puck.userData.focusBlend)
        if (!Number.isFinite(focusBlend)) focusBlend = 1
        focusBlend += (focusAmt - focusBlend) * LERP
        if (Math.abs(focusBlend - focusAmt) < 0.001) focusBlend = focusAmt
        puck.userData.focusBlend = focusBlend
        const dimFactor = 0.14 + 0.86 * focusBlend

        const deck = (puck.userData.deck as DeckItem[] | undefined) ?? []
        for (const item of deck) {
          if (item.mode === 'stand' && item.standObject) {
            item.standObject.position.y = item.standRestY
            const scale = 1 + (HOVER_SCALE - 1) * hover
            const liftPx = -STAND_HOVER_LIFT_PX * hover
            item.standFaceEl.style.transform = `translateY(${liftPx}px) scale(${scale})`
            item.standFaceEl.style.filter =
              hover > 0.02
                ? `drop-shadow(0 ${8 * hover}px ${16 * hover}px rgb(0 0 0 / ${0.3 * hover}))`
                : 'drop-shadow(0 1px 2px rgb(0 0 0 / 0.2))'
            item.standObject.element.style.opacity = String(dimFactor)
            item.standObject.element.style.pointerEvents = focusBlend > 0.4 ? 'auto' : 'none'
          } else if (item.mode === 'flat' && item.flatObject && item.standObject) {
            const showStand = hover > 0.12
            const flatOpacity = Math.max(0, 1 - hover * 1.4) * dimFactor
            const standOpacity = Math.min(1, hover * 1.35) * dimFactor
            item.flatObject.element.style.opacity = String(flatOpacity)
            item.flatObject.element.style.pointerEvents =
              focusBlend > 0.4 && hover < 0.45 ? 'auto' : 'none'
            item.standObject.element.style.opacity = String(standOpacity)
            item.standObject.element.style.pointerEvents =
              focusBlend > 0.4 && showStand ? 'auto' : 'none'
            const scale = 1 + (HOVER_SCALE - 1) * hover
            const liftPx = -FLAT_HOVER_LIFT_PX * hover
            item.standFaceEl.style.transform = `translateY(${liftPx}px) scale(${scale})`
            item.standFaceEl.style.filter =
              hover > 0.02
                ? `drop-shadow(0 ${8 * hover}px ${16 * hover}px rgb(0 0 0 / ${0.3 * hover}))`
                : 'drop-shadow(0 1px 2px rgb(0 0 0 / 0.2))'
            item.faceEl.style.filter = 'drop-shadow(0 1px 2px rgb(0 0 0 / 0.2))'
          }
        }

        const areaLabelEl = puck.userData.areaLabelEl as HTMLElement | undefined
        if (areaLabelEl) {
          areaLabelEl.style.opacity = String(dimFactor)
          areaLabelEl.style.pointerEvents = focusBlend > 0.4 ? 'auto' : 'none'
        }

        const nameEl = puck.userData.nameEl as HTMLElement | undefined
        if (nameEl) {
          const showName = camera.zoom >= LABEL_ZOOM || hover > 0.15
          nameEl.style.opacity = showName ? String(dimFactor) : '0'
        }

        const halo = puck.userData.halo as THREE.Mesh
        const shadow = puck.userData.shadow as THREE.Mesh
        const topMat = puck.userData.topMat as THREE.MeshStandardMaterial
        const sideMats = (puck.userData.sideMats as THREE.MeshStandardMaterial[] | undefined) ?? []
        const baseEmissive = Number(puck.userData.baseEmissive) || 0
        if (halo?.material) {
          ;(halo.material as THREE.MeshBasicMaterial).opacity = 0.5 * hover * focusBlend
          halo.scale.setScalar(1 + 0.22 * hover)
        }
        if (shadow?.material) {
          ;(shadow.material as THREE.MeshBasicMaterial).opacity = (0.05 + 0.18 * hover) * dimFactor
          shadow.scale.setScalar(1 + 0.4 * hover)
        }
        if (topMat) {
          topMat.emissiveIntensity = (baseEmissive + 0.22 * hover) * (0.35 + 0.65 * focusBlend)
          topMat.opacity = dimFactor
          topMat.transparent = dimFactor < 0.99
        }
        for (const side of sideMats) {
          side.opacity = dimFactor
          side.transparent = dimFactor < 0.99
        }
      }

      for (const line of edgeLines) {
        const mat = line.material as THREE.LineBasicMaterial
        const base = Number(line.userData.baseOpacity) || palette.edgeRest
        if (!hoverId) {
          mat.opacity += (base - mat.opacity) * LERP
          continue
        }
        const linked =
          focusIds.has(String(line.userData.sourceId)) &&
          focusIds.has(String(line.userData.targetId))
        const want = linked ? Math.min(1, base + 0.35) : palette.edgeDim * 0.35
        mat.opacity += (want - mat.opacity) * LERP
      }
    }

    const tick = () => {
      frame = requestAnimationFrame(tick)
      controls.update(clock.getDelta())
      const pct = Math.round(camera.zoom * 100)
      if (pct !== zoomShown) {
        zoomShown = pct
        setZoomPct(pct)
      }
      tickHover()
      renderer.render(scene, camera)
      standRenderer.render(scene, camera)
      flatRenderer.render(scene, camera)
    }
    tick()

    const onResize = () => {
      const w = host.clientWidth || 800
      const h = host.clientHeight || 600
      const a = w / h
      camera.left = (-frustum * a) / 2
      camera.right = (frustum * a) / 2
      camera.top = frustum / 2
      camera.bottom = -frustum / 2
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
      standRenderer.setSize(w, h)
      flatRenderer.setSize(w, h)
    }
    const ro = new ResizeObserver(onResize)
    ro.observe(host)

    return () => {
      cancelAnimationFrame(frame)
      if (flashTimer) clearTimeout(flashTimer)
      focusApiRef.current = null
      setTip(null)
      ro.disconnect()
      renderer.domElement.removeEventListener('pointermove', onPointerMove)
      renderer.domElement.removeEventListener('pointerdown', onPointerDown)
      renderer.domElement.removeEventListener('pointerup', onPointerUp)
      renderer.domElement.removeEventListener('pointerleave', onPointerLeave)
      controls.dispose()
      for (const markRoot of reactRoots) markRoot.unmount()
      renderer.dispose()
      if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement)
      if (standRenderer.domElement.parentElement === host) host.removeChild(standRenderer.domElement)
      if (flatRenderer.domElement.parentElement === host) host.removeChild(flatRenderer.domElement)
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose()
          const mat = obj.material
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
          else mat.dispose()
        }
      })
      controlsRef.current = null
    }
  }, [graph, linkedIds, isDark])

  const regionLabel =
    tip?.node.region && tip.node.region !== 'overview' && tip.node.region !== 'shared'
      ? (graph.regions ?? []).find((region) => region.id === tip.node.region)?.label
      : tip?.node.region === 'shared'
        ? kindLabel('department')
        : undefined
  const tipBits = tip ? tipMeta(tip.node, regionLabel) : []
  const hostRect = hostRef.current?.getBoundingClientRect()
  const tipStyle =
    tip && hostRect
      ? {
          left: Math.min(Math.max(12, tip.x - hostRect.left + 16), (hostRect.width || 400) - 240),
          top: Math.min(Math.max(12, tip.y - hostRect.top + 16), (hostRect.height || 400) - 120),
        }
      : undefined

  return (
    <div className="relative h-full min-h-0 w-full bg-bg">
      <div ref={hostRef} className="absolute inset-0 touch-none" />
      {tip && tipStyle ? (
        <div
          className="pointer-events-none absolute z-30 w-56 rounded-xl border border-border/40 bg-bg-surface/90 p-2.5 shadow-sm backdrop-blur-sm dark:bg-bg-surface/88"
          style={tipStyle}
        >
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-bg">
              <OrgNodeFace node={tip.node} size={32} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-text-heading">{tip.node.label}</p>
              <p className="mt-0.5 text-[11px] text-text-muted">{kindLabel(tip.node.kind)}</p>
              {tipBits.length ? (
                <p className="mt-1 truncate text-[11px] text-text-secondary">{tipBits.join(' · ')}</p>
              ) : null}
              <p className="mt-1.5 text-[10px] text-text-muted">{openHint}</p>
            </div>
          </div>
        </div>
      ) : null}
      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center gap-2 px-3">
        <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-border/40 bg-bg-surface/75 px-1.5 py-1 shadow-sm backdrop-blur-sm">
          <button
            type="button"
            className="rounded-full px-2.5 py-1 text-xs text-text-muted hover:bg-bg-elevated hover:text-text-heading"
            onClick={() =>
              controlsRef.current?.zoomTo(
                Math.max(0.25, (controlsRef.current.camera as THREE.OrthographicCamera).zoom / 1.15),
                true,
              )
            }
          >
            -
          </button>
          <span className="min-w-[3rem] text-center text-[11px] tabular-nums text-text-muted">{zoomPct}%</span>
          <button
            type="button"
            className="rounded-full px-2.5 py-1 text-xs text-text-muted hover:bg-bg-elevated hover:text-text-heading"
            onClick={() =>
              controlsRef.current?.zoomTo(
                Math.min(4, (controlsRef.current.camera as THREE.OrthographicCamera).zoom * 1.15),
                true,
              )
            }
          >
            +
          </button>
          <button
            type="button"
            className="rounded-full px-2.5 py-1 text-xs text-text-muted hover:bg-bg-elevated hover:text-text-heading"
            onClick={() => {
              const controls = controlsRef.current
              if (!controls) return
              void controls.setLookAt(420, 480, 420, 0, 0, 0, true)
              void controls.zoomTo(1, true)
            }}
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  )
}

export default OrgMakeScene
