import * as THREE from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import type { ScenePalette } from './stage'

/** Always-visible name chips for the Grid in 3D. Small, on a solid background, at any zoom. */

export type NodeChip = { object: CSS2DObject; el: HTMLButtonElement }

export function makeNodeChip(
  { nodeId, name, meta, metaColor }: { nodeId: string; name: string; meta: string; metaColor?: string },
  palette: ScenePalette,
  handlers: { onEnter: () => void; onLeave: () => void; onClick: () => void },
): NodeChip {
  const el = document.createElement('button')
  el.type = 'button'
  el.dataset.testid = 'grid-node'
  el.dataset.nodeId = nodeId
  // CSS2DRenderer resets `display` on the element it positions, so the two lines are block spans.
  el.style.cssText = [
    'pointer-events:auto',
    'max-width:150px',
    'padding:2px 7px',
    'border-radius:7px',
    `border:1px solid ${palette.labelBorder}`,
    `background:${palette.labelBg}`,
    `color:${palette.labelFg}`,
    'font:600 11px/14px var(--font-sans), system-ui, sans-serif',
    'text-align:left',
    'white-space:nowrap',
    'cursor:pointer',
    'transition:opacity 120ms ease, box-shadow 120ms ease',
    'box-shadow:0 1px 2px rgb(0 0 0 / 0.15)',
  ].join(';')
  const nameEl = document.createElement('span')
  nameEl.textContent = name
  nameEl.style.cssText = 'display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis'
  el.appendChild(nameEl)
  if (meta) {
    const metaEl = document.createElement('span')
    metaEl.textContent = meta
    metaEl.style.cssText = `display:block;font-weight:500;font-size:10px;line-height:12px;opacity:0.75;${metaColor ? `color:${metaColor};opacity:1` : ''}`
    el.appendChild(metaEl)
  }
  el.addEventListener('mouseenter', handlers.onEnter)
  el.addEventListener('mouseleave', handlers.onLeave)
  el.addEventListener('focus', handlers.onEnter)
  el.addEventListener('blur', handlers.onLeave)
  el.addEventListener('click', handlers.onClick)
  const object = new CSS2DObject(el)
  object.center.set(0.5, 1)
  return { object, el }
}

export type ChipSlot = { object: CSS2DObject; el: HTMLElement; priority: number }

const GAP = 3
const MAX_LIFT = 120
const point = new THREE.Vector3()

/**
 * Lifts chips that would cover a chip with a higher priority, so every name stays readable.
 * Positions are screen pixels; the anchor of a chip is its bottom centre.
 */
export function declutterChips(slots: ChipSlot[], camera: THREE.Camera, width: number, height: number) {
  const placed: Array<{ l: number; r: number; t: number; b: number }> = []
  const ordered = [...slots].sort((a, b) => b.priority - a.priority)
  for (const slot of ordered) {
    if (!slot.object.visible) continue
    slot.object.getWorldPosition(point).project(camera)
    const x = (point.x * 0.5 + 0.5) * width
    const y = (-point.y * 0.5 + 0.5) * height
    const w = slot.el.offsetWidth
    const h = slot.el.offsetHeight
    let lift = 0
    for (let guard = 0; guard < 8; guard++) {
      const l = x - w / 2
      const r = x + w / 2
      const b = y - lift
      const t = b - h
      const hit = placed.find((p) => l < p.r && r > p.l && t < p.b && b > p.t)
      if (!hit || lift >= MAX_LIFT) break
      lift = Math.min(MAX_LIFT, y - hit.t + GAP)
    }
    placed.push({ l: x - w / 2, r: x + w / 2, t: y - lift - h, b: y - lift })
    const margin = lift ? `${-lift}px` : ''
    if (slot.el.style.marginTop !== margin) slot.el.style.marginTop = margin
  }
}

/** Column title above a plate (Intake, Executors, Flow, Result) or a zone name. */
export function makeTitle(text: string, sub: string, color: string): CSS2DObject {
  const el = document.createElement('div')
  el.style.cssText = [
    'pointer-events:none',
    'font:600 10.5px/14px var(--font-sans), system-ui, sans-serif',
    'letter-spacing:0.08em',
    'text-transform:uppercase',
    `color:${color}`,
    'white-space:nowrap',
  ].join(';')
  el.textContent = sub ? `${text} · ${sub}` : text
  const object = new CSS2DObject(el)
  object.center.set(0, 1)
  return object
}
