import * as THREE from 'three'
import { Line2 } from 'three/addons/lines/Line2.js'
import { LineGeometry } from 'three/addons/lines/LineGeometry.js'
import { LineMaterial } from 'three/addons/lines/LineMaterial.js'

/**
 * Points along a raised arc between two marks. Start and end stay fixed;
 * `rise` lifts only the peak so parallel strips fan apart in the middle.
 */
export function arcPoints(a: THREE.Vector3, b: THREE.Vector3, { lift = 18, rise = 0, segments = 36 } = {}): number[] {
  const start = a.clone()
  const end = b.clone()
  const mid = start.clone().lerp(end, 0.5)
  mid.y += lift + rise + start.distanceTo(end) * 0.14
  const curve = new THREE.QuadraticBezierCurve3(start, mid, end)
  return curve.getPoints(segments).flatMap((p) => [p.x, p.y, p.z])
}

export type ArcStyle = { color: string; width: number; dash: string | null; opacity: number }

/** Screen-space line with the same width and dash pattern as the 2D board. */
export function makeArc(points: number[], style: ArcStyle, resolution: THREE.Vector2): Line2 {
  const geometry = new LineGeometry()
  geometry.setPositions(points)
  const [dashSize, gapSize] = (style.dash ?? '').split(' ').map(Number)
  const material = new LineMaterial({
    color: new THREE.Color(style.color).getHex(),
    linewidth: style.width,
    transparent: true,
    opacity: style.opacity,
    dashed: Boolean(style.dash),
    dashSize: dashSize || 1,
    gapSize: gapSize || 1,
    depthWrite: false,
  })
  material.resolution.copy(resolution)
  const line = new Line2(geometry, material)
  line.computeLineDistances()
  line.userData.baseOpacity = style.opacity
  return line
}

export function setArcOpacity(line: Line2, opacity: number, lerp = 0.2): void {
  const material = line.material as LineMaterial
  material.opacity += (opacity - material.opacity) * lerp
}
