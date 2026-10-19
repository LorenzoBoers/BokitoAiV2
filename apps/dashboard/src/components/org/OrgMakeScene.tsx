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
const LABEL_ZOOM = 1.35
/** Orthographic zoom: 1 = 100%. Wheel / buttons clamp to this range. */
const ZOOM_DEFAULT = 1.2
/** Opening frame and Reset: All disc centered, a step wider than 100%. */
const HOME_ZOOM = 0.85
const ZOOM_MIN = 0.7
const ZOOM_MAX = 2.4
/**
 * How far the camera target may truck past the org content bounds.
 * Ratio of the content span, with a floor so tiny orgs still have room to pan.
 */
const PAN_BOUNDARY_PAD_RATIO = 0.4
const PAN_BOUNDARY_PAD_MIN = 140
const PAN_BOUNDARY_FALLBACK = 260

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
  /** Floor color at the far edge of the stage. A small step darker than `ground`. */
  groundEdge: number
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
      wash: 0x141418,
      ground: 0x141418,
      groundEdge: 0x0f0f13,
      gridMajor: 0x3a3a42,
      gridMinor: 0x2a2a32,
      gridOpacity: 0.4,
      floor: 0x222228,
      floorOpacity: 1,
      areaTint: 0x3b82f6,
      edge: accent,
      ring: accent,
      faceBg: '#141418',
      labelBorder: 'rgb(70 70 78 / 0.7)',
      labelBg: 'rgb(36 36 40)',
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
  // Paper-white stage: almost no fog, a readable grid, soft blue area wash.
  return {
    wash: 0xd4d0ca,
    ground: 0xd4d0ca,
    groundEdge: 0xbab6b0,
    gridMajor: 0xb0aca6,
    gridMinor: 0xbcb8b2,
    gridOpacity: 0.55,
    floor: 0xb7c8e2,
    floorOpacity: 1,
    areaTint: 0x93c5fd,
    edge: accent,
    ring: accent,
    faceBg: '#ffffff',
    labelBorder: 'rgb(226 232 240 / 0.95)',
    labelBg: 'rgb(255 255 255)',
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
  /** Legend hover writes here. Lights the row and its direct links, without moving the camera. */
  highlightRef?: { current: (id: string | null) => void }
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

function areaTintColor(palette: ScenePalette, tintIndex: number): THREE.Color {
  const tint = new THREE.Color(palette.areaTint)
  tint.offsetHSL((tintIndex % 6) * 0.08, 0.08, 0)
  return tint
}

const STAGE_VERTEX = `
  varying vec2 vUv;
  varying vec2 vWorld;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`

/** Unlit stage. The middle stays `center`; the rim eases a step darker. */
function makeStageFloor(size: number, center: number, edge: number): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uCenter: { value: new THREE.Color(center) },
      uEdge: { value: new THREE.Color(edge) },
    },
    vertexShader: STAGE_VERTEX,
    fragmentShader: `
      varying vec2 vWorld;
      uniform vec3 uCenter;
      uniform vec3 uEdge;
      void main() {
        float shade = smoothstep(180.0, 640.0, length(vWorld));
        gl_FragColor = vec4(mix(uCenter, uEdge, shade), 1.0);
        #include <colorspace_fragment>
      }
    `,
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = -0.5
  return mesh
}

/** Dots at the crossings of a hairline square grid, fading toward the edge. */
function makeSoftGrid(
  size: number,
  divisions: number,
  color: number,
  edgeColor: number,
  opacity: number,
): THREE.Mesh {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uEdge: { value: new THREE.Color(edgeColor) },
      uOpacity: { value: opacity },
      uDivisions: { value: divisions },
      uRadius: { value: 1.25 },
      uFeather: { value: 0.7 },
      uLine: { value: 0.65 },
    },
    vertexShader: STAGE_VERTEX,
    fragmentShader: `
      varying vec2 vUv;
      varying vec2 vWorld;
      uniform vec3 uColor;
      uniform vec3 uEdge;
      uniform float uOpacity;
      uniform float uDivisions;
      uniform float uRadius;
      uniform float uFeather;
      uniform float uLine;
      void main() {
        vec2 g = vUv * uDivisions;
        vec2 fw = max(fwidth(g), vec2(1e-4));
        vec2 fromNode = min(fract(g), 1.0 - fract(g));
        float distPx = length(fromNode / fw);
        float dotMask = 1.0 - smoothstep(uRadius - uFeather, uRadius + uFeather, distPx);
        float linePx = min(fromNode.x / fw.x, fromNode.y / fw.y);
        float lineMask = 1.0 - smoothstep(uLine - 0.25, uLine + 0.45, linePx);
        float mark = max(dotMask, lineMask * 0.72);
        float radial = length(vUv - 0.5) * 2.0;
        float fade = 1.0 - smoothstep(0.28, 0.92, radial);
        float alpha = mark * uOpacity * fade;
        if (alpha < 0.01) discard;
        float shade = smoothstep(180.0, 640.0, length(vWorld));
        gl_FragColor = vec4(mix(uColor, uEdge, shade), alpha);
        #include <colorspace_fragment>
      }
    `,
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = 0.05
  mesh.renderOrder = 0
  return mesh
}

/** Island fill. Resting color stays deep; hover lifts it toward the tint. */
function floorColor(palette: ScenePalette, tintIndex: number): THREE.Color {
  const tint = areaTintColor(palette, tintIndex)
  const base = new THREE.Color(palette.floor)
  const dark = base.r < 0.45
  base.lerp(tint, dark ? 0.12 : 0.1)
  if (dark) base.multiplyScalar(0.72)
  return base
}

function makeFloor(
  points: number[][],
  palette: ScenePalette,
  tintIndex: number,
  shape: string = 'ellipse',
): THREE.Mesh {
  let geo: THREE.BufferGeometry
  if (shape === 'ring') {
    const outer = Math.hypot(points[0]?.[0] ?? 0, points[0]?.[1] ?? 0) || 64
    geo = new THREE.CircleGeometry(outer, 80)
    geo.rotateX(-Math.PI / 2)
  } else {
    const shapePath = new THREE.Shape()
    const first = points[0]
    shapePath.moveTo(first[0], -first[1])
    for (let i = 1; i < points.length; i += 1) {
      shapePath.lineTo(points[i][0], -points[i][1])
    }
    shapePath.closePath()
    geo = new THREE.ShapeGeometry(shapePath)
    geo.rotateX(-Math.PI / 2)
  }
  const base = floorColor(palette, tintIndex)
  const mat = new THREE.MeshBasicMaterial({
    color: base,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.position.y = 0.15
  mesh.receiveShadow = true
  mesh.renderOrder = 1
  mesh.userData.baseColor = base.clone()
  mesh.userData.baseOpacity = 0.38
  mesh.userData.points = points
  if (points.length > 2) {
    const border = makeAreaBorder(points, base.clone())
    mesh.add(border)
    mesh.userData.border = border
    mesh.userData.borderColor = (border.material as THREE.MeshBasicMaterial).color.clone()
  }
  return mesh
}

/** Solid rim in the island color, so connectors meet an edge instead of a film. */
function makeAreaBorder(points: number[][], color: THREE.Color): THREE.Mesh {
  const curve = new THREE.CatmullRomCurve3(
    points.map((point) => new THREE.Vector3(point[0], 0.08, point[1])),
    true,
  )
  const geo = new THREE.TubeGeometry(curve, Math.max(points.length, 8) * 2, 0.55, 5, true)
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.28, depthWrite: false }),
  )
  mesh.renderOrder = 2
  return mesh
}

/** Boundary sample of an island ellipse closest to the direction of (px, py). */
function rimToward(
  hubX: number,
  hubY: number,
  px: number,
  py: number,
  points: number[][],
  inset: number,
): [number, number] {
  const aim = Math.atan2(py - hubY, px - hubX)
  let best = points[0]
  let bestDiff = Infinity
  for (const point of points) {
    const angle = Math.atan2(point[1] - hubY, point[0] - hubX)
    const diff = Math.abs(Math.atan2(Math.sin(angle - aim), Math.cos(angle - aim)))
    if (diff < bestDiff) {
      bestDiff = diff
      best = point
    }
  }
  const dx = hubX - best[0]
  const dy = hubY - best[1]
  const span = Math.hypot(dx, dy) || 1
  return [best[0] + (dx / span) * inset, best[1] + (dy / span) * inset]
}

function makeAreaLabel(
  text: string,
  palette: ScenePalette,
  onOpen: () => void,
  meta?: { kind: string; detail: string; hint: string },
): CSS2DObject {
  const wrap = document.createElement('div')
  wrap.style.pointerEvents = 'auto'
  wrap.style.cursor = 'pointer'
  wrap.addEventListener('click', (event) => {
    event.stopPropagation()
    onOpen()
  })
  const chip = document.createElement('div')
  chip.style.padding = '4px 10px'
  chip.style.borderRadius = '9999px'
  chip.style.fontSize = '11px'
  chip.style.fontWeight = '600'
  chip.style.letterSpacing = '0.01em'
  chip.style.whiteSpace = 'nowrap'
  chip.style.textAlign = 'center'
  chip.style.background = palette.labelBg
  chip.style.color = palette.labelFg
  chip.style.border = `1px solid ${palette.labelBorder}`
  chip.style.backdropFilter = 'blur(10px)'
  chip.style.boxShadow = '0 1px 2px rgb(0 0 0 / 0.06)'
  const name = document.createElement('div')
  name.textContent = text
  chip.append(name)
  if (meta) {
    const extra = document.createElement('div')
    extra.dataset.role = 'meta'
    extra.style.display = 'none'
    extra.style.marginTop = '2px'
    extra.style.fontSize = '10px'
    extra.style.fontWeight = '500'
    extra.style.lineHeight = '1.3'
    extra.style.whiteSpace = 'normal'
    extra.style.opacity = '0.78'
    const kindLine = document.createElement('div')
    kindLine.textContent = meta.kind
    extra.append(kindLine)
    if (meta.detail) {
      const detailLine = document.createElement('div')
      detailLine.textContent = meta.detail
      extra.append(detailLine)
    }
    if (meta.hint) {
      const hintLine = document.createElement('div')
      hintLine.textContent = meta.hint
      hintLine.style.marginTop = '3px'
      hintLine.style.opacity = '0.7'
      extra.append(hintLine)
    }
    chip.append(extra)
  }
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
  // Transparent from the first frame. Flipping it on later (when a hover dims
  // the disc) does not take effect without a shader rebuild, so bright flow
  // discs such as bugs stay fully lit while the CSS icon on top fades.
  const side = new THREE.MeshStandardMaterial({
    color: topColor.clone().multiplyScalar(palette.sideScale),
    roughness: 0.7,
    metalness: 0.06,
    transparent: true,
    opacity: 1,
    depthWrite: true,
  })
  const top = new THREE.MeshStandardMaterial({
    color: topColor,
    roughness: 0.55,
    metalness: 0.08,
    emissive: hex,
    emissiveIntensity: palette.emissiveIntensity,
    transparent: true,
    opacity: 1,
    depthWrite: true,
  })
  top.userData.baseColor = topColor.clone()
  side.userData.baseColor = side.color.clone()
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.92, h, 28), top)
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.position.y = h / 2
  // Connectors are renderOrder 0 and do not write depth. The disc paints over them.
  mesh.renderOrder = 4
  group.add(mesh)

  const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.02, r * 1.02, h * 0.35, 28), side)
  rim.position.y = h * 0.18
  rim.castShadow = true
  rim.renderOrder = 4
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
  halo.renderOrder = 5
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

const LINE_CREST = -0.2

function layOnGround(curve: THREE.CubicBezierCurve3, radius: number) {
  const y = LINE_CREST - radius
  curve.v0.y = y
  curve.v1.y = y
  curve.v2.y = y
  curve.v3.y = y
}

function connectorMaterial(color: THREE.ColorRepresentation, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  })
}

function edgeCurve(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  lift = 2.5,
  bow = 0,
): THREE.CubicBezierCurve3 {
  const mx = (ax + bx) / 2
  const mz = (az + bz) / 2
  const span = Math.hypot(mx, mz) || 1
  const ox = (mx / span) * bow
  const oz = (mz / span) * bow
  return new THREE.CubicBezierCurve3(
    new THREE.Vector3(ax, LINE_CREST, az),
    new THREE.Vector3(ax + (bx - ax) * 0.35 + ox, LINE_CREST + lift, az + (bz - az) * 0.35 + oz),
    new THREE.Vector3(ax + (bx - ax) * 0.65 + ox, LINE_CREST + lift, az + (bz - az) * 0.65 + oz),
    new THREE.Vector3(bx, LINE_CREST, bz),
  )
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
  const geo = new THREE.BufferGeometry().setFromPoints(edgeCurve(ax, az, bx, bz, 0, 0).getPoints(16))
  const mat = new THREE.LineBasicMaterial({
    color: palette.edge,
    transparent: true,
    opacity,
    depthWrite: false,
  })
  const line = new THREE.Line(geo, mat)
  line.renderOrder = 0
  line.userData = { sourceId, targetId, baseOpacity: opacity, thick: false }
  return line
}

/** A flat ribbon on the ground. Company links stay a quiet tube. */
function makeMemberEdge(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  opacity: number,
  color: THREE.Color,
  sourceId: string,
  targetId: string,
  radius = 2.6,
): THREE.Mesh {
  const curve = edgeCurve(ax, az, bx, bz, 0, 0)
  layOnGround(curve, radius)
  const geo = new THREE.TubeGeometry(curve, 28, radius, 8, false)
  const mesh = new THREE.Mesh(geo, connectorMaterial(color, opacity))
  mesh.renderOrder = 0
  mesh.userData = { sourceId, targetId, baseOpacity: opacity, thick: true }
  return mesh
}

function islandInk(floor: THREE.Mesh | undefined, palette: ScenePalette, lift: number): THREE.Color {
  const ink = (floor?.userData.baseColor as THREE.Color | undefined)?.clone() ?? floorColor(palette, 0)
  const lightStage = palette.faceBg === '#ffffff'
  ink.lerp(new THREE.Color(0xffffff), lightStage ? 0.9 : lift)
  return ink
}

/** Department↔department: flat and solid, so the island covers the inner end. */
function makeHierarchyEdge(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  opacity: number,
  palette: ScenePalette,
  sourceId: string,
  targetId: string,
): THREE.Mesh {
  const curve = edgeCurve(ax, az, bx, bz, 0, 0)
  const radius = 1.6
  layOnGround(curve, radius)
  const geo = new THREE.TubeGeometry(curve, 24, radius, 8, false)
  const mesh = new THREE.Mesh(geo, connectorMaterial(palette.edge, opacity))
  mesh.renderOrder = 0
  mesh.userData = { sourceId, targetId, baseOpacity: opacity, thick: true }
  return mesh
}

function isPersonKind(kind: string): boolean {
  return kind === 'agent' || kind === 'user'
}

/** Person → department: a taper that fades out before the island, so it never enters the fill. */
function shoreOutside(
  px: number,
  py: number,
  points: number[][],
  gap: number,
): [number, number] {
  let cx = 0
  let cy = 0
  for (const point of points) {
    cx += point[0]
    cy += point[1]
  }
  cx /= points.length
  cy /= points.length
  const dx = px - cx
  const dy = py - cy
  let bestT = -1
  let hitX = cx
  let hitY = cy
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    const ex = b[0] - a[0]
    const ey = b[1] - a[1]
    const denom = dx * ey - dy * ex
    if (Math.abs(denom) < 1e-6) continue
    const t = ((a[0] - cx) * ey - (a[1] - cy) * ex) / denom
    const u = ((a[0] - cx) * dy - (a[1] - cy) * dx) / denom
    if (t > bestT && u >= 0 && u <= 1) {
      bestT = t
      hitX = cx + dx * t
      hitY = cy + dy * t
    }
  }
  const span = Math.hypot(px - hitX, py - hitY) || 1
  return [hitX + ((px - hitX) / span) * gap, hitY + ((py - hitY) / span) * gap]
}

function makeShoreTie(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  opacity: number,
  color: THREE.Color,
  sourceId: string,
  targetId: string,
): THREE.Mesh {
  const dx = bx - ax
  const dz = bz - az
  const len = Math.hypot(dx, dz) || 1
  const px = -dz / len
  const pz = dx / len
  const segments = 18
  const positions: number[] = []
  const along: number[] = []
  const y = 0.42
  const widthAtPerson = 1.7
  const widthAtShore = 0.15
  for (let i = 0; i < segments; i += 1) {
    const t0 = i / segments
    const t1 = (i + 1) / segments
    const w0 = widthAtPerson + (widthAtShore - widthAtPerson) * t0 ** 1.2
    const w1 = widthAtPerson + (widthAtShore - widthAtPerson) * t1 ** 1.2
    const x0 = ax + dx * t0
    const z0 = az + dz * t0
    const x1 = ax + dx * t1
    const z1 = az + dz * t1
    const quad = [
      [x0 + px * w0, z0 + pz * w0, t0],
      [x0 - px * w0, z0 - pz * w0, t0],
      [x1 + px * w1, z1 + pz * w1, t1],
      [x0 - px * w0, z0 - pz * w0, t0],
      [x1 - px * w1, z1 - pz * w1, t1],
      [x1 + px * w1, z1 + pz * w1, t1],
    ]
    for (const [x, z, t] of quad) {
      positions.push(x, y, z)
      along.push(t)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1))
  const mesh = new THREE.Mesh(
    geo,
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uColor: { value: color },
        uOpacity: { value: opacity },
      },
      vertexShader: `
        attribute float aAlong;
        varying float vAlong;
        void main() {
          vAlong = aAlong;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying float vAlong;
        uniform vec3 uColor;
        uniform float uOpacity;
        void main() {
          float fade = 1.0 - smoothstep(0.72, 1.0, vAlong);
          gl_FragColor = vec4(uColor, uOpacity * fade);
          #include <colorspace_fragment>
        }
      `,
    }),
  )
  mesh.renderOrder = 2
  mesh.userData = { sourceId, targetId, baseOpacity: opacity, thick: true }
  return mesh
}

function bowSign(a: string, b: string): number {
  let hash = 0
  const key = a < b ? a + b : b + a
  for (let i = 0; i < key.length; i += 1) hash = (hash * 33 + key.charCodeAt(i)) >>> 0
  return hash % 2 === 0 ? 1 : -1
}

/** Two items on one island: a short bridge that fades before either mark. */
function makeNeuralFilament(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  opacity: number,
  color: THREE.Color,
  sourceId: string,
  targetId: string,
  maxSpan = 64,
): THREE.Mesh | null {
  const dx = bx - ax
  const dz = bz - az
  const len = Math.hypot(dx, dz) || 1
  const pull = Math.min(14, len * 0.28)
  const sx = ax + (dx / len) * pull
  const sz = az + (dz / len) * pull
  const ex = bx - (dx / len) * pull
  const ez = bz - (dz / len) * pull
  const span = Math.hypot(ex - sx, ez - sz)
  if (span < 8 || span > maxSpan) return null
  const bow = Math.min(3.2, span * 0.04) * bowSign(sourceId, targetId)
  const px = (-dz / len) * bow
  const pz = (dx / len) * bow
  const segments = 14
  const positions: number[] = []
  const along: number[] = []
  const y = 0.36
  for (let i = 0; i < segments; i += 1) {
    const t0 = i / segments
    const t1 = (i + 1) / segments
    const bend = (t: number) => {
      const u = t
      const arc = Math.sin(u * Math.PI)
      return {
        x: sx + (ex - sx) * u + px * arc,
        z: sz + (ez - sz) * u + pz * arc,
      }
    }
    const p0 = bend(t0)
    const p1 = bend(t1)
    const w0 = 0.55 + 0.7 * Math.sin(t0 * Math.PI)
    const w1 = 0.55 + 0.7 * Math.sin(t1 * Math.PI)
    const tx = p1.x - p0.x
    const tz = p1.z - p0.z
    const tl = Math.hypot(tx, tz) || 1
    const nx = -tz / tl
    const nz = tx / tl
    const quad: [number, number, number][] = [
      [p0.x + nx * w0, p0.z + nz * w0, t0],
      [p0.x - nx * w0, p0.z - nz * w0, t0],
      [p1.x + nx * w1, p1.z + nz * w1, t1],
      [p0.x - nx * w0, p0.z - nz * w0, t0],
      [p1.x - nx * w1, p1.z - nz * w1, t1],
      [p1.x + nx * w1, p1.z + nz * w1, t1],
    ]
    for (const [x, z, t] of quad) {
      positions.push(x, y, z)
      along.push(t)
    }
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1))
  const mesh = new THREE.Mesh(
    geo,
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uColor: { value: color },
        uOpacity: { value: opacity },
      },
      vertexShader: `
        attribute float aAlong;
        varying float vAlong;
        void main() {
          vAlong = aAlong;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying float vAlong;
        uniform vec3 uColor;
        uniform float uOpacity;
        void main() {
          float fade = smoothstep(0.0, 0.22, vAlong) * (1.0 - smoothstep(0.78, 1.0, vAlong));
          gl_FragColor = vec4(uColor, uOpacity * fade);
          #include <colorspace_fragment>
        }
      `,
    }),
  )
  mesh.renderOrder = 2
  mesh.userData = { sourceId, targetId, baseOpacity: opacity, thick: true }
  return mesh
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

function labelDetail(
  node: OrgGraphNode,
  regions: { id: string; label: string }[] | undefined,
  kindName: (kind: string) => string,
): string {
  let regionLabel: string | undefined
  if (node.region && node.region !== 'overview') {
    regionLabel =
      node.region === 'shared'
        ? kindName('department')
        : regions?.find((region) => region.id === node.region)?.label
  }
  return tipMeta(node, regionLabel).join(' · ')
}

function tipMeta(node: OrgGraphNode, regionLabel?: string): string[] {
  const mark = node.mark ?? {}
  const bits: string[] = []
  if (mark.channel) bits.push(mark.channel)
  if (mark.provider) bits.push(mark.provider)
  if (regionLabel) bits.push(regionLabel)
  return bits
}

function createNameChip(
  node: OrgGraphNode,
  palette: ScenePalette,
  kindText: string,
  detail: string,
  hint: string,
): HTMLElement {
  const el = document.createElement('div')
  el.style.padding = '3px 8px'
  el.style.borderRadius = '8px'
  el.style.fontSize = '11px'
  el.style.fontWeight = '600'
  el.style.lineHeight = '1.25'
  el.style.whiteSpace = 'nowrap'
  el.style.maxWidth = '148px'
  el.style.background = palette.labelBg
  el.style.color = palette.labelFg
  el.style.border = `1px solid ${palette.labelBorder}`
  el.style.backdropFilter = 'blur(8px)'
  el.style.boxShadow = '0 1px 2px rgb(0 0 0 / 0.08)'
  el.style.opacity = '0'
  el.style.transition = 'opacity 120ms ease'
  el.style.pointerEvents = 'none'
  el.style.textAlign = 'center'
  const name = document.createElement('div')
  name.dataset.role = 'name'
  name.textContent = node.label
  name.style.overflow = 'hidden'
  name.style.textOverflow = 'ellipsis'
  const meta = document.createElement('div')
  meta.dataset.role = 'meta'
  meta.style.display = 'none'
  meta.style.marginTop = '2px'
  meta.style.fontSize = '10px'
  meta.style.fontWeight = '500'
  meta.style.lineHeight = '1.3'
  meta.style.whiteSpace = 'normal'
  meta.style.opacity = '0.78'
  const kindLine = document.createElement('div')
  kindLine.textContent = kindText
  meta.append(kindLine)
  if (detail) {
    const detailLine = document.createElement('div')
    detailLine.textContent = detail
    meta.append(detailLine)
  }
  if (hint) {
    const hintLine = document.createElement('div')
    hintLine.textContent = hint
    hintLine.style.marginTop = '3px'
    hintLine.style.opacity = '0.7'
    meta.append(hintLine)
  }
  el.append(name, meta)
  return el
}

function placeStandingName(nameEl: HTMLElement) {
  nameEl.style.position = 'absolute'
  nameEl.style.top = '100%'
  nameEl.style.marginTop = '8px'
  nameEl.style.left = '50%'
  nameEl.style.transform = 'translateX(-50%)'
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

/** Make Grid–style WebGL org map: 3D pucks, floors, camera-controls pan/zoom/orbit. */
export function OrgMakeScene({
  graph,
  linkedIds,
  onOpenNode,
  focusNodeId,
  onFocused,
  highlightRef,
  kindLabel,
  openHint,
}: Props) {
  const { isDark } = useTheme()
  const hostRef = useRef<HTMLDivElement>(null)
  const [zoomPct, setZoomPct] = useState(Math.round(HOME_ZOOM * 100))
  const controlsRef = useRef<CameraControls | null>(null)
  const focusApiRef = useRef<{ focus: (id: string) => void } | null>(null)
  const homeFrameRef = useRef<{
    lookAt: [number, number, number, number, number, number]
    zoom: number
  } | null>(null)
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
    // Smaller frustum = the compact org layout fills more of the viewport.
    const frustum = 300
    const camera = new THREE.OrthographicCamera(
      (-frustum * aspect) / 2,
      (frustum * aspect) / 2,
      frustum / 2,
      -frustum / 2,
      0.1,
      12000,
    )

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(width, height)
    // Filmic tone mapping pulls pure white down to gray. Light mode stays paper white.
    renderer.toneMapping = THREE.NoToneMapping
    renderer.shadowMap.enabled = isDark
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
    controls.setLookAt(260, 300, 260, 0, 0, 0, false)
    controls.mouseButtons.left = CameraControls.ACTION.TRUCK
    controls.mouseButtons.right = CameraControls.ACTION.ROTATE
    controls.mouseButtons.middle = CameraControls.ACTION.DOLLY
    controls.mouseButtons.wheel = CameraControls.ACTION.ZOOM
    controls.touches.one = CameraControls.ACTION.TOUCH_TRUCK
    controls.touches.two = CameraControls.ACTION.TOUCH_DOLLY_TRUCK
    controls.minPolarAngle = Math.PI * 0.18
    // Keep the view above the horizon so marks do not slide under the bottom edge.
    controls.maxPolarAngle = Math.PI * 0.32
    controls.minZoom = ZOOM_MIN
    controls.maxZoom = ZOOM_MAX
    controls.dollyToCursor = true
    controls.smoothTime = 0.05
    controls.draggingSmoothTime = 0.02
    controls.zoomTo(HOME_ZOOM, false)
    controlsRef.current = controls
    /** Home framing after the graph is measured — Reset returns here. */
    let homeLookAt: [number, number, number, number, number, number] = [260, 300, 260, 0, 0, 0]
    let homeZoom = HOME_ZOOM

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

    // Unlit, so the stage color stays the color. A lit white plane renders gray.
    scene.add(makeStageFloor(5200, palette.ground, palette.groundEdge))

    const grid = makeSoftGrid(2800, 400, palette.gridMajor, palette.gridMinor, palette.gridOpacity)
    scene.add(grid)

    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]))
    const puckById = new Map<string, THREE.Group>()
    const root = new THREE.Group()
    scene.add(root)

    const regionById = new Map((graph.regions ?? []).map((region) => [region.id, region]))
    const floorByRegion = new Map<string, THREE.Mesh>()
    let allOuter = 64
    for (const region of graph.regions ?? []) {
      if (region.shape === 'ring' && region.points[0]) {
        allOuter = Math.hypot(region.points[0][0], region.points[0][1]) || allOuter
      }
    }
    const lineRoot = new THREE.Group()
    // Stay in the default group so island floors and pucks paint after the tubes.
    lineRoot.renderOrder = 0
    root.add(lineRoot)
    ;(graph.regions ?? []).forEach((region, index) => {
      if (region.points.length < 3) return
      const floor = makeFloor(region.points, palette, index, region.shape ?? 'ellipse')
      floor.userData.nodeId = region.id
      floor.userData.isFloor = true
      floor.userData.hub = region.labelAt ?? null
      floorByRegion.set(region.id, floor)
      root.add(floor)
      if (region.labelAt) {
        const ringOpacity = isDark ? 0.1 : 0.12
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(18, 20, 48),
          new THREE.MeshBasicMaterial({
            color: palette.ring,
            transparent: true,
            opacity: ringOpacity,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        )
        ring.rotation.x = -Math.PI / 2
        ring.position.set(region.labelAt[0], 0.25, region.labelAt[1])
        ring.userData.baseOpacity = ringOpacity
        floor.userData.areaRing = ring
        root.add(ring)
      }
    })

    // Org-structure adjacency only (membership + hierarchy + org) for hover focus.
    const neighbors = new Map<string, Set<string>>()
    for (const edge of graph.edges) {
      if (!linkedIds.has(edge.source) || !linkedIds.has(edge.target)) continue
      if (edge.kind === 'item') {
        const left = nodeById.get(edge.source)
        const right = nodeById.get(edge.target)
        if (!left?.region || !right?.region) continue
        const sameIsland = left.region === right.region && left.region !== 'shared'
        const bridge = left.region !== right.region
        if (!sameIsland && !bridge) continue
        if (left.kind === 'department' || right.kind === 'department') continue
        if (left.kind === 'organization' || right.kind === 'organization') continue
      }
      if (!neighbors.has(edge.source)) neighbors.set(edge.source, new Set())
      if (!neighbors.has(edge.target)) neighbors.set(edge.target, new Set())
      neighbors.get(edge.source)!.add(edge.target)
      neighbors.get(edge.target)!.add(edge.source)
    }

    const edgeLines: THREE.Object3D[] = []
    for (const edge of graph.edges) {
      const a = nodeById.get(edge.source)
      const b = nodeById.get(edge.target)
      if (!a || !b || !linkedIds.has(a.id) || !linkedIds.has(b.id)) continue
      if (edge.kind === 'item') {
        if (a.kind === 'department' || b.kind === 'department') continue
        if (a.kind === 'organization' || b.kind === 'organization') continue
        const sameIsland = Boolean(a.region) && a.region === b.region && a.region !== 'shared'
        const bridge = Boolean(a.region) && Boolean(b.region) && a.region !== b.region
        if (!sameIsland && !bridge) continue
        const floor = floorByRegion.get(a.region)
        const filament = makeNeuralFilament(
          a.x,
          a.y,
          b.x,
          b.y,
          sameIsland ? 0.7 : 0.55,
          islandInk(floor, palette, 0.55),
          a.id,
          b.id,
          sameIsland ? 150 : 720,
        )
        if (!filament) continue
        edgeLines.push(filament)
        lineRoot.add(filament)
        continue
      }
      if (edge.kind === 'member') {
        const personToArea =
          (isPersonKind(a.kind) && b.kind === 'department') ||
          (isPersonKind(b.kind) && a.kind === 'department')
        if (!personToArea) continue
        if (a.kind === 'organization' || b.kind === 'organization') continue
        const person = isPersonKind(a.kind) ? a : b
        const area = a.kind === 'department' ? a : b
        const floor = floorByRegion.get(area.id)
        const points = floor?.userData.points as number[][] | undefined
        let endX = area.x
        let endY = area.y
        if (points && points.length > 2) {
          const rim = shoreOutside(person.x, person.y, points, 28)
          endX = rim[0]
          endY = rim[1]
        }
        const approach = Math.hypot(endX - person.x, endY - person.y)
        if (approach < 22) continue
        const step = 18 / approach
        const tube = makeNeuralFilament(
          person.x + (endX - person.x) * step,
          person.y + (endY - person.y) * step,
          endX,
          endY,
          0.7,
          islandInk(floor, palette, 0.55),
          a.id,
          b.id,
          420,
        )
        if (!tube) continue
        edgeLines.push(tube)
        lineRoot.add(tube)
        continue
      }
      if (edge.kind === 'hierarchy') {
        const floorA = floorByRegion.get(a.id)
        const floorB = floorByRegion.get(b.id)
        const pointsA = floorA?.userData.points as number[][] | undefined
        const pointsB = floorB?.userData.points as number[][] | undefined
        let ax = a.x
        let ay = a.y
        let bx = b.x
        let by = b.y
        if (pointsA && pointsA.length > 2) {
          const rim = shoreOutside(b.x, b.y, pointsA, 14)
          ax = rim[0]
          ay = rim[1]
        }
        if (pointsB && pointsB.length > 2) {
          const rim = shoreOutside(a.x, a.y, pointsB, 14)
          bx = rim[0]
          by = rim[1]
        }
        const tube = makeNeuralFilament(
          ax,
          ay,
          bx,
          by,
          0.7,
          islandInk(floorA ?? floorB, palette, 0.55),
          a.id,
          b.id,
          420,
        )
        if (!tube) continue
        edgeLines.push(tube)
        lineRoot.add(tube)
        continue
      }
      if (edge.kind === 'org') {
        const orgNode = a.kind === 'organization' ? a : b.kind === 'organization' ? b : null
        const area = a.kind === 'department' ? a : b.kind === 'department' ? b : null
        if (!orgNode || !area) continue
        const floor = floorByRegion.get(area.id)
        const hub = floor?.userData.hub as number[] | null | undefined
        const points = floor?.userData.points as number[][] | undefined
        const dist = Math.hypot(area.x, area.y) || 1
        const startX = (area.x / dist) * allOuter
        const startY = (area.y / dist) * allOuter
        let endX = area.x
        let endY = area.y
        if (hub && points && points.length > 2) {
          const rim = shoreOutside(orgNode.x, orgNode.y, points, 14)
          endX = rim[0]
          endY = rim[1]
        }
        if (Math.hypot(endX - startX, endY - startY) < 10) continue
        const spoke = makeNeuralFilament(
          startX,
          startY,
          endX,
          endY,
          0.7,
          islandInk(floor, palette, 0.55),
          a.id,
          b.id,
          420,
        )
        if (!spoke) continue
        edgeLines.push(spoke)
        lineRoot.add(spoke)
        continue
      }
      const line = makeNeuralFilament(
        a.x,
        a.y,
        b.x,
        b.y,
        0.7,
        islandInk(floorByRegion.get(a.region), palette, 0.55),
        a.id,
        b.id,
        420,
      )
      if (!line) continue
      edgeLines.push(line)
      lineRoot.add(line)
    }

    standRenderer.domElement.style.pointerEvents = 'none'
    flatRenderer.domElement.style.pointerEvents = 'none'

    let hovered: THREE.Group | null = null
    let focusIds = new Set<string>()
    const relatedOf = (nodeId: string): Set<string> => {
      const out = new Set<string>([nodeId])
      const node = nodeById.get(nodeId)
      if (node?.kind === 'department') {
        for (const other of neighbors.get(nodeId) ?? []) out.add(other)
        for (const other of graph.nodes) {
          if (other.region === nodeId) out.add(other.id)
        }
        return out
      }
      if (node?.kind === 'organization') {
        for (const other of graph.nodes) {
          if (other.region === nodeId) out.add(other.id)
        }
        return out
      }
      if (node && isPersonKind(node.kind)) {
        const areas = new Set<string>()
        for (const other of neighbors.get(nodeId) ?? []) {
          const n = nodeById.get(other)
          if (n?.kind !== 'department') continue
          out.add(other)
          areas.add(other)
        }
        for (const other of graph.nodes) {
          if (other.region && areas.has(other.region)) out.add(other.id)
        }
        for (const edge of graph.edges) {
          if (edge.kind !== 'member') continue
          if (!areas.has(edge.source) && !areas.has(edge.target)) continue
          out.add(edge.source)
          out.add(edge.target)
        }
        // A direct item link stays lit. Its island does not: other pucks there still dim.
        for (const edge of graph.edges) {
          if (edge.kind !== 'item') continue
          if (edge.source !== nodeId && edge.target !== nodeId) continue
          out.add(edge.source)
          out.add(edge.target)
        }
        for (const other of graph.nodes) {
          if (other.kind === 'organization') out.add(other.id)
        }
        return out
      }
      if (node?.region && node.region.startsWith('department:')) out.add(node.region)
      for (const other of neighbors.get(nodeId) ?? []) out.add(other)
      return out
    }
    const directOf = (nodeId: string): Set<string> => {
      const out = new Set<string>([nodeId])
      for (const edge of graph.edges) {
        if (edge.source === nodeId) out.add(edge.target)
        else if (edge.target === nodeId) out.add(edge.source)
      }
      return out
    }
    let legendId: string | null = null
    let legendPuck: THREE.Group | null = null
    const applyHover = (puck: THREE.Group | null, node: OrgGraphNode | null) => {
      if (hovered && hovered !== puck) hovered.userData.hoverTarget = 0
      hovered = puck
      if (hovered) hovered.userData.hoverTarget = 1
      else if (legendPuck) legendPuck.userData.hoverTarget = 1
      focusIds = node ? relatedOf(node.id) : legendId ? directOf(legendId) : new Set()
    }
    if (highlightRef) {
      highlightRef.current = (id) => {
        if (legendPuck && legendPuck !== hovered) legendPuck.userData.hoverTarget = 0
        legendId = id
        legendPuck = id ? puckById.get(id) ?? null : null
        if (legendPuck && !hovered) legendPuck.userData.hoverTarget = 1
        if (!hovered) focusIds = id ? directOf(id) : new Set()
      }
    }

    for (const node of graph.nodes) {
      if (!linkedIds.has(node.id)) continue

      // Departments are the islands themselves — name chip on the area, no puck.
      // The region floor is the hit target (whole area lights up on hover).
      if (node.kind === 'department') {
        const group = new THREE.Group()
        group.userData = { nodeId: node.id, href: node.href, label: node.label, kind: node.kind }
        group.position.set(node.x, 0, node.y)
        const region = regionById.get(node.id)
        const labelAt = region?.labelAt
        const label = makeAreaLabel(node.label, palette, () => onOpenRef.current(node), {
          kind: kindLabel(node.kind),
          detail: labelDetail(node, graph.regions, kindLabel),
          hint: openHint,
        })
        label.position.set(
          labelAt ? labelAt[0] - node.x : 0,
          1.2,
          labelAt ? labelAt[1] - node.y : 0,
        )
        group.add(label)
        const floor = floorByRegion.get(node.id)
        group.userData.hover = 0
        group.userData.hoverTarget = 0
        group.userData.deck = []
        group.userData.isArea = true
        group.userData.areaLabelEl = label.element
        group.userData.floor = floor ?? null
        puckById.set(node.id, group)
        root.add(group)
        continue
      }

      const puck = makePuck(node, palette)
      if (node.kind === 'organization') {
        const centerFloor = floorByRegion.get(node.id)
        if (centerFloor) {
          puck.userData.floor = centerFloor
          puck.userData.isArea = true
        }
        if (node.label) {
          const label = makeAreaLabel(node.label, palette, () => onOpenRef.current(node), {
            kind: kindLabel(node.kind),
            detail: labelDetail(node, graph.regions, kindLabel),
            hint: openHint,
          })
          label.position.set(0, 1.4, 22)
          puck.add(label)
          puck.userData.areaLabelEl = label.element
        }
      }
      puckById.set(node.id, puck)
      root.add(puck)

      const platformH = Number(puck.userData.platformH) || 4
      const platformR = Number(puck.userData.platformR) || 10
      const onMarkHover = (n: OrgGraphNode | null) => {
        if (!n) {
          applyHover(null, null)
          return
        }
        applyHover(puckById.get(n.id) ?? null, n)
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
        if (node.kind !== 'organization') {
          const nameEl = createNameChip(
            node,
            palette,
            kindLabel(node.kind),
            labelDetail(node, graph.regions, kindLabel),
            openHint,
          )
          placeStandingName(nameEl)
          faceEl.style.position = 'relative'
          faceEl.append(nameEl)
          puck.userData.nameEl = nameEl
        }
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
        const nameEl = createNameChip(
          node,
          palette,
          kindLabel(node.kind),
          labelDetail(node, graph.regions, kindLabel),
          openHint,
        )
        const nameObj = new CSS2DObject(nameEl)
        nameObj.position.set(0, 0.2, 0)
        nameObj.center.set(0.5, 0)
        puck.add(nameObj)
        puck.userData.nameEl = nameEl
        reactRoots.push(flatDom.root, standDom.root)
      }
    }

    const box = new THREE.Box3().setFromObject(root)
    if (!box.isEmpty()) {
      const size = box.getSize(new THREE.Vector3())
      const span = Math.max(size.x, size.z, 140)
      // All sits at the company node. Frame that disc, not the bounding box of every island.
      const orgNode = graph.nodes.find((node) => node.kind === 'organization')
      const allX = orgNode?.x ?? 0
      const allZ = orgNode?.y ?? 0
      homeLookAt = [allX + 260, 300, allZ + 260, allX, 0, allZ]
      homeZoom = HOME_ZOOM
      homeFrameRef.current = { lookAt: homeLookAt, zoom: homeZoom }
      controls.setLookAt(...homeLookAt, false)
      controls.zoomTo(homeZoom, false)
      // Keep left-drag trucking near the organisation — no endless empty void.
      const pad = Math.max(span * PAN_BOUNDARY_PAD_RATIO, PAN_BOUNDARY_PAD_MIN)
      const boundary = box.clone()
      boundary.min.y = -40
      boundary.max.y = 40
      boundary.expandByVector(new THREE.Vector3(pad, 0, pad))
      controls.setBoundary(boundary)
      controls.boundaryFriction = 0
    } else {
      controls.setBoundary(
        new THREE.Box3(
          new THREE.Vector3(-PAN_BOUNDARY_FALLBACK, -40, -PAN_BOUNDARY_FALLBACK),
          new THREE.Vector3(PAN_BOUNDARY_FALLBACK, 40, PAN_BOUNDARY_FALLBACK),
        ),
      )
      controls.boundaryFriction = 0
    }

    let flashTimer: ReturnType<typeof setTimeout> | null = null
    focusApiRef.current = {
      focus: (id: string) => {
        const puck = puckById.get(id)
        if (!puck) return
        const x = puck.position.x
        const z = puck.position.z
        void controls.setLookAt(x + 160, 200, z + 160, x, 0, z, true)
        // Keep current zoom when finding a mark, but never below 100% or above 200%.
        void controls.zoomTo(Math.min(ZOOM_MAX, Math.max(ZOOM_DEFAULT, camera.zoom)), true)
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
      applyHover(next, node)
    }

    const pick = (clientX: number, clientY: number): THREE.Group | null => {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1
      raycaster.setFromCamera(pointer, camera)
      const floors = [...floorByRegion.values()]
      const hits = raycaster.intersectObjects([...puckById.values(), ...floors], true)
      let areaHit: THREE.Group | null = null
      for (const hit of hits) {
        let obj: THREE.Object3D | null = hit.object
        while (obj && !obj.userData?.nodeId) obj = obj.parent
        if (!obj?.userData?.nodeId) continue
        const id = String(obj.userData.nodeId)
        const kind = nodeById.get(id)?.kind
        // Prefer marks on the island; floor only when nothing else is under the pointer.
        if (kind && kind !== 'department') {
          const puck = puckById.get(id)
          if (puck) return puck
        }
        if (kind === 'department' && !areaHit) {
          areaHit = puckById.get(id) ?? null
        }
      }
      return areaHit
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
        const kind = nodeById.get(nodeId)?.kind
        const inFocus = kind === 'organization' || !focusing || focusIds.has(nodeId)
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
        const dimFactor = kind === 'organization' ? 1 : 0.06 + 0.94 * focusBlend
        puck.userData.cssDim = dimFactor
        const areaGlow =
          puck.userData.isArea && focusing && inFocus ? Math.max(hover, 0.85) : hover

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
          const chip = areaLabelEl.firstElementChild as HTMLElement | null
          const areaLit = areaGlow > 0.05
          areaLabelEl.style.opacity = String(Math.max(dimFactor, areaLit ? 1 : dimFactor))
          areaLabelEl.style.pointerEvents = focusBlend > 0.4 ? 'auto' : 'none'
          if (chip) {
            const expanded = hover > 0.12
            const meta = chip.querySelector('[data-role="meta"]') as HTMLElement | null
            if (meta) meta.style.display = expanded ? 'block' : 'none'
            chip.style.borderRadius = expanded ? '8px' : '9999px'
            chip.style.whiteSpace = expanded ? 'normal' : 'nowrap'
            chip.style.transform = areaLit ? `scale(${1 + 0.04 * areaGlow})` : 'scale(1)'
            chip.style.boxShadow = areaLit
              ? `0 2px 10px rgb(0 0 0 / ${0.12 + 0.18 * hover})`
              : '0 1px 2px rgb(0 0 0 / 0.06)'
          }
        }

        const floor = puck.userData.floor as THREE.Mesh | null | undefined
        if (floor?.material) {
          const floorMat = floor.material as THREE.MeshBasicMaterial
          const base = floor.userData.baseColor as THREE.Color | undefined
          if (base) {
            const dim = 0.72 + 0.28 * dimFactor
            const lighten = 0.46 * areaGlow
            const target = base.clone().multiplyScalar(dim)
            target.lerp(new THREE.Color(0xffffff), lighten)
            floorMat.color.lerp(target, LERP)
          }
          const restOpacity = Number(floor.userData.baseOpacity) || 0.38
          const wantOpacity = (restOpacity + 0.4 * areaGlow) * dimFactor
          floorMat.opacity += (wantOpacity - floorMat.opacity) * LERP
          const border = floor.userData.border as THREE.Mesh | undefined
          const borderBase = floor.userData.borderColor as THREE.Color | undefined
          if (border?.material && borderBase) {
            const borderMat = border.material as THREE.MeshBasicMaterial
            const dim = 0.72 + 0.28 * dimFactor
            const lighten = 0.46 * areaGlow
            const target = borderBase.clone().multiplyScalar(dim)
            target.lerp(new THREE.Color(0xffffff), lighten)
            borderMat.color.lerp(target, LERP)
            const borderOpacity = (0.46 + 0.4 * areaGlow) * dimFactor
            borderMat.opacity += (borderOpacity - borderMat.opacity) * LERP
          }
          const ring = floor.userData.areaRing as THREE.Mesh | undefined
          if (ring?.material) {
            const ringMat = ring.material as THREE.MeshBasicMaterial
            const ringBase = Number(ring.userData.baseOpacity) || 0.1
            ringMat.opacity += (ringBase * dimFactor - ringMat.opacity) * LERP
          }
        }

        const nameEl = puck.userData.nameEl as HTMLElement | undefined
        if (nameEl) {
          const expanded = hover > 0.12
          const showName = expanded || camera.zoom >= LABEL_ZOOM
          nameEl.style.opacity = showName ? String(dimFactor) : '0'
          nameEl.style.maxWidth = expanded ? '220px' : '148px'
          const nameLine = nameEl.querySelector('[data-role="name"]') as HTMLElement | null
          const metaLine = nameEl.querySelector('[data-role="meta"]') as HTMLElement | null
          if (nameLine) {
            nameLine.style.whiteSpace = expanded ? 'normal' : 'nowrap'
            nameLine.style.overflow = expanded ? 'visible' : 'hidden'
          }
          if (metaLine) metaLine.style.display = expanded ? 'block' : 'none'
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
        const shade = 0.18 + 0.82 * dimFactor
        if (topMat) {
          const base = topMat.userData.baseColor as THREE.Color | undefined
          if (base) topMat.color.copy(base).multiplyScalar(shade)
          topMat.emissiveIntensity = dimFactor * (baseEmissive + 0.22 * hover)
          topMat.opacity = dimFactor
        }
        for (const sideMat of sideMats) {
          const base = sideMat.userData.baseColor as THREE.Color | undefined
          if (base) sideMat.color.copy(base).multiplyScalar(shade)
          sideMat.opacity = dimFactor
        }
      }

      for (const line of edgeLines) {
        const mat = (line as THREE.Line | THREE.Mesh).material as THREE.Material & {
          opacity: number
          uniforms?: { uOpacity?: { value: number } }
        }
        const base = Number(line.userData.baseOpacity) || palette.edgeRest
        const current = mat.uniforms?.uOpacity ? mat.uniforms.uOpacity.value : mat.opacity
        const write = (value: number) => {
          if (mat.uniforms?.uOpacity) mat.uniforms.uOpacity.value = value
          else mat.opacity = value
        }
        if (!hoverId) {
          write(current + (base - current) * LERP)
          continue
        }
        const linked =
          focusIds.has(String(line.userData.sourceId)) &&
          focusIds.has(String(line.userData.targetId))
        const want = linked ? Math.min(1, base + 0.35) : palette.edgeDim * 0.35
        write(current + (want - current) * LERP)
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
      // CSS renderers can leave icon opacity at 1. Paint dim after they run.
      for (const puck of puckById.values()) {
        const dim = Number(puck.userData.cssDim)
        if (!Number.isFinite(dim)) continue
        const hoverAmt = Number(puck.userData.hover) || 0
        const deck = (puck.userData.deck as DeckItem[] | undefined) ?? []
        for (const item of deck) {
          if (item.mode === 'stand' && item.standObject) {
            item.standObject.element.style.opacity = String(dim)
            item.faceEl.style.opacity = String(dim)
          } else if (item.mode === 'flat' && item.flatObject) {
            const flatOpacity = Math.max(0, 1 - hoverAmt * 1.4) * dim
            item.flatObject.element.style.opacity = String(flatOpacity)
            item.faceEl.style.opacity = String(flatOpacity)
          }
        }
      }
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
      if (highlightRef) highlightRef.current = () => {}
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
  }, [graph, linkedIds, isDark, kindLabel, openHint])

  return (
    <div className={`relative z-0 h-full min-h-0 w-full ${isDark ? 'bg-[#141418]' : 'bg-[#d4d0ca]'}`}>
      <div ref={hostRef} className="absolute inset-0 z-0 touch-none" />
      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center gap-2 px-3">
        <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-border/40 bg-bg-surface/75 px-1.5 py-1 shadow-sm backdrop-blur-sm">
          <button
            type="button"
            className="rounded-full px-2.5 py-1 text-xs text-text-muted hover:bg-bg-elevated hover:text-text-heading"
            onClick={() =>
              controlsRef.current?.zoomTo(
                Math.max(
                  ZOOM_MIN,
                  (controlsRef.current.camera as THREE.OrthographicCamera).zoom / 1.15,
                ),
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
                Math.min(
                  ZOOM_MAX,
                  (controlsRef.current.camera as THREE.OrthographicCamera).zoom * 1.15,
                ),
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
              // homeLookAt / homeZoom live in the effect closure; re-read via ref stash.
              const home = homeFrameRef.current
              if (home) {
                void controls.setLookAt(...home.lookAt, true)
                void controls.zoomTo(home.zoom, true)
              } else {
                void controls.setLookAt(260, 300, 260, 0, 0, 0, true)
                void controls.zoomTo(HOME_ZOOM, true)
              }
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
