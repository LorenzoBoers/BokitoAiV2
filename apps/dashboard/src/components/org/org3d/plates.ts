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

/** A ring on the floor around a mark: selection or a bottleneck. */
export function makeRing(radius: number, color: number): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.RingGeometry(radius + 2, radius + 4, 48),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }),
  )
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = 1.2
  return mesh
}

/** Stacked column: one segment per entry, first at the bottom. Total height is the sum. */
export function makeColumn(segments: Array<{ height: number; color: string | number }>, radius: number, base: number): THREE.Group {
  const group = new THREE.Group()
  let y = base
  for (const seg of segments) {
    if (seg.height <= 0) continue
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, seg.height, 24),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(seg.color), roughness: 0.5, transparent: true, opacity: 0.95 }),
    )
    mesh.position.y = y + seg.height / 2
    mesh.castShadow = true
    mesh.userData.baseOpacity = 0.95
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
