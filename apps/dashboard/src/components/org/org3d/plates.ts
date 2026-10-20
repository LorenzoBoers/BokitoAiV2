import * as THREE from 'three'

/** Floor pieces and marks for the Grid in 3D: plates, zones, pucks, columns and Works in cubes. */

/** A flat plate on the floor from an outline in (x, z). */
export function makePlate(points: Array<[number, number]>, color: number, opacity: number, y = 0.4): THREE.Mesh {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)))
  const mesh = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }),
  )
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = y
  return mesh
}

/** An opaque slab from `top - height` to `top`, with a hairline along its edges. */
export function makeSlab(
  points: Array<[number, number]>,
  colors: { top: number; side: number; edge: number },
  height: number,
  top = 0.4,
): THREE.Group {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)))
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false })
  const mesh = new THREE.Mesh(geometry, [
    new THREE.MeshBasicMaterial({ color: colors.top }),
    new THREE.MeshBasicMaterial({ color: colors.side }),
  ])
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color: colors.edge, transparent: true, opacity: 0.9 }),
  )
  const group = new THREE.Group()
  group.add(mesh, edges)
  group.rotation.x = -Math.PI / 2
  group.position.y = top - height
  return group
}

/** A department zone: a tinted rectangle with a thin border, centered on (x, z). */
export function makeZone(x: number, z: number, w: number, d: number, color: number, dashed: boolean): THREE.Group {
  const group = new THREE.Group()
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.1, depthWrite: false }),
  )
  fill.rotation.x = -Math.PI / 2
  fill.position.set(x, 0.8, z)
  group.add(fill)
  const outline = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x - w / 2, 0.9, z - d / 2),
      new THREE.Vector3(x + w / 2, 0.9, z - d / 2),
      new THREE.Vector3(x + w / 2, 0.9, z + d / 2),
      new THREE.Vector3(x - w / 2, 0.9, z + d / 2),
    ]),
    dashed
      ? new THREE.LineDashedMaterial({ color, transparent: true, opacity: 0.7, dashSize: 6, gapSize: 5 })
      : new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.45 }),
  )
  outline.computeLineDistances()
  group.add(outline)
  return group
}

const radialTextures = new Map<string, THREE.CanvasTexture>()

/** Cached radial gradient texture from `stops` ([offset, alpha] on white). */
function radialTexture(key: string, stops: Array<[number, number]>): THREE.CanvasTexture {
  const cached = radialTextures.get(key)
  if (cached) return cached
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  for (const [offset, alpha] of stops) gradient.addColorStop(offset, `rgba(255,255,255,${alpha})`)
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  radialTextures.set(key, texture)
  return texture
}

function floorDecal(radius: number, material: THREE.Material, y: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), material)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = y
  mesh.renderOrder = 1
  mesh.raycast = () => {}
  return mesh
}

/** Soft colored light pool on the floor. Additive on dark stages, plain alpha on light ones. */
export function makeFloorGlow(color: number, radius: number, opacity: number, additive = true): THREE.Mesh {
  const material = new THREE.MeshBasicMaterial({
    color,
    map: radialTexture('glow', [[0, 1], [0.35, 0.45], [1, 0]]),
    transparent: true,
    opacity,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  })
  return floorDecal(radius, material, 0.6)
}

/** Soft contact shadow, nudged toward the viewer so a mark reads as lifted off the plate. */
export function makeContactShadow(radius: number, opacity: number): THREE.Mesh {
  const material = new THREE.MeshBasicMaterial({
    color: 0x000000,
    map: radialTexture('shadow', [[0, 1], [0.5, 0.6], [1, 0]]),
    transparent: true,
    opacity,
    depthWrite: false,
  })
  const mesh = floorDecal(radius, material, 0.5)
  mesh.position.z = radius * 0.18
  return mesh
}

export function makePuck(color: number, radius: number, height: number, opacity = 1): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, height, 40),
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.55,
      metalness: 0.05,
      transparent: true,
      opacity,
      emissive: color,
      emissiveIntensity: 0.06,
    }),
  )
  mesh.position.y = height / 2 + 1
  mesh.castShadow = opacity >= 1
  mesh.userData.baseOpacity = opacity
  return mesh
}

/**
 * Flat pad with a tinted fill and a visible outer ring.
 * Used when a node has no open count (no pillar); matches the Workflow reference marks.
 * Outer ring stays at the mark radius; the inner disc is deliberately smaller so a
 * clear gap shows between fill and ring (about half the ring diameter).
 */
export function makeFlatMark(color: number, radius: number, opacity = 1, dark = true): THREE.Group {
  const group = new THREE.Group()
  group.add(makeContactShadow(radius * 1.7, (dark ? 0.55 : 0.22) * opacity))

  const wash = new THREE.Mesh(
    new THREE.CircleGeometry(radius * 0.92, 48),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.14 * opacity, depthWrite: false }),
  )
  wash.rotation.x = -Math.PI / 2
  wash.position.y = 1.05
  group.add(wash)

  const fill = new THREE.Mesh(
    new THREE.CircleGeometry(radius * 0.48, 40),
    new THREE.MeshStandardMaterial({
      color,
      roughness: 0.5,
      metalness: 0.04,
      transparent: true,
      opacity,
      emissive: color,
      emissiveIntensity: 0.35,
    }),
  )
  fill.rotation.x = -Math.PI / 2
  fill.position.y = 1.15
  fill.castShadow = opacity >= 1
  fill.receiveShadow = true
  fill.userData.baseOpacity = opacity
  group.add(fill)

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.92, radius * 1.28, 48),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.62 * opacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
  )
  ring.rotation.x = -Math.PI / 2
  ring.position.y = 1.2
  ring.userData.baseOpacity = 0.62 * opacity
  group.add(ring)

  const core = makeFloorGlow(new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.45).getHex(), radius * 0.62, 0.75 * opacity)
  core.position.y = 1.25
  group.add(core)
  return group
}

/**
 * Stacked column: one segment per entry, first at the bottom. Total height is the sum.
 * Glass-like: alpha climbs from `bottomAlpha` at the foot to solid at the top cap,
 * over a colored light pool on the floor.
 */
export function makeColumn(
  segments: Array<{ height: number; color: string | number }>,
  radius: number,
  base: number,
  options: { dark?: boolean; bottomAlpha?: number } = {},
): THREE.Group {
  const { dark = true, bottomAlpha = 0.22 } = options
  const group = new THREE.Group()
  const parts = segments.filter((s) => s.height > 0)
  const total = parts.reduce((sum, s) => sum + s.height, 0) + Math.max(0, parts.length - 1) * 0.4
  if (parts.length) {
    const glowColor = new THREE.Color(parts[0].color).getHex()
    group.add(makeFloorGlow(glowColor, radius * 3.2, dark ? 0.55 : 0.3, dark))
  }
  let y = base
  for (const seg of parts) {
    const geometry = new THREE.CylinderGeometry(radius, radius, seg.height, 32)
    const position = geometry.attributes.position
    const alphas = new Float32Array(position.count * 4)
    for (let i = 0; i < position.count; i++) {
      const along = total > 0 ? (y + seg.height / 2 + position.getY(i) - base) / total : 1
      alphas.set([1, 1, 1, bottomAlpha + (1 - bottomAlpha) * Math.pow(Math.min(1, Math.max(0, along)), 0.8)], i * 4)
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(alphas, 4))
    const color = new THREE.Color(seg.color)
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color,
        roughness: 0.45,
        emissive: color,
        emissiveIntensity: dark ? 0.22 : 0.08,
        vertexColors: true,
        transparent: true,
        opacity: 1,
        depthWrite: false,
      }),
    )
    mesh.position.y = y + seg.height / 2
    mesh.castShadow = true
    mesh.userData.baseOpacity = 1
    group.add(mesh)
    y += seg.height + 0.4
  }
  return group
}

/** Small cubes around a folder puck: solid for Bokito items, wireframe for a connection. */
export function makeWorksInCubes(items: Array<{ origin: 'bokito' | 'connection' }>, radius: number, y: number): THREE.Group {
  const group = new THREE.Group()
  const size = 4.2
  items.slice(0, 8).forEach((item, i) => {
    const angle = (i / Math.max(1, Math.min(items.length, 8))) * Math.PI * 2 - Math.PI / 2
    const x = Math.cos(angle) * (radius + 7)
    const z = Math.sin(angle) * (radius + 7)
    const geometry = new THREE.BoxGeometry(size, size, size)
    const cube =
      item.origin === 'connection'
        ? new THREE.LineSegments(
            new THREE.EdgesGeometry(geometry),
            new THREE.LineBasicMaterial({ color: 0xe2e2e0, transparent: true, opacity: 0.9 }),
          )
        : new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xe2e2e0, roughness: 0.6, transparent: true, opacity: 1 }))
    cube.position.set(x, y + size / 2, z)
    cube.userData.baseOpacity = 1
    group.add(cube)
  })
  return group
}

/** Every material under an object, for dimming. */
export function materialsOf(object: THREE.Object3D): Array<THREE.Material & { opacity: number }> {
  const out: Array<THREE.Material & { opacity: number }> = []
  object.traverse((child) => {
    const mat = (child as THREE.Mesh).material
    if (!mat) return
    for (const m of Array.isArray(mat) ? mat : [mat]) {
      if (!m.userData.baseOpacity) m.userData.baseOpacity = (m as THREE.Material & { opacity: number }).opacity
      out.push(m as THREE.Material & { opacity: number })
    }
  })
  return out
}
