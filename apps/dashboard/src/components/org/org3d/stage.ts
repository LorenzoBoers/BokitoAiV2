import * as THREE from 'three'

/** Shared stage for the Grid scenes: theme palette, unlit floor and the dot grid. */

export type ScenePalette = {
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

export function cssRgbHex(token: string): number {
  const [r, g, b] = cssRgbTuple(token)
  return (r << 16) + (g << 8) + b
}

export function themePalette(isDark: boolean): ScenePalette {
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
export function makeStageFloor(size: number, center: number, edge: number): THREE.Mesh {
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

/** World-space box the grid hugs: it is full inside and fades out within `feather` past the edge. */
export type GridArea = { minX: number; maxX: number; minZ: number; maxZ: number; feather: number }

/** Dots at the crossings of a hairline square grid, fading toward the edge (or just past `area`). */
export function makeSoftGrid(
  size: number,
  divisions: number,
  color: number,
  edgeColor: number,
  opacity: number,
  area?: GridArea,
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
      uArea: { value: area ? new THREE.Vector4((area.minX + area.maxX) / 2, (area.minZ + area.maxZ) / 2, (area.maxX - area.minX) / 2, (area.maxZ - area.minZ) / 2) : new THREE.Vector4() },
      uAreaFeather: { value: area ? area.feather : 0 },
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
      uniform vec4 uArea;
      uniform float uAreaFeather;
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
        if (uAreaFeather > 0.0) {
          vec2 outside = max(abs(vWorld - uArea.xy) - uArea.zw, 0.0);
          fade = 1.0 - smoothstep(0.0, uAreaFeather, length(outside));
        }
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
