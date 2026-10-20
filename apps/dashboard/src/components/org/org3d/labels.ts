import * as THREE from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import type { ScenePalette } from './stage'

/** Always-visible name chips for the Grid in 3D. Small, on a solid background, at any zoom. */

export type NodeChip = { object: CSS2DObject; el: HTMLButtonElement; dx: number }

const HEAD = 26

export function makeNodeChip(
  { nodeId, name, meta, metaColor, face }: { nodeId: string; name: string; meta: string; metaColor?: string; face?: HTMLElement },
  palette: ScenePalette,
  handlers: { onEnter: () => void; onLeave: () => void; onClick: () => void },
): NodeChip {
  const el = document.createElement('button')
  el.type = 'button'
  el.dataset.testid = 'grid-node'
  el.dataset.nodeId = nodeId
  const pill = [
    'padding:2px 7px',
    'border-radius:7px',
    `border:1px solid ${palette.labelBorder}`,
    `background:${palette.labelBg}`,
    `color:${palette.labelFg}`,
    'box-shadow:0 1px 2px rgb(0 0 0 / 0.15)',
  ]
  el.style.cssText = [
    'pointer-events:auto',
    'font:600 11px/14px var(--font-sans), system-ui, sans-serif',
    'text-align:left',
    'white-space:nowrap',
    'cursor:pointer',
    'transition:opacity 120ms ease, box-shadow 120ms ease',
    ...(face ? ['padding:0', 'border:0', 'background:none', `margin-left:${-HEAD / 2}px`] : ['max-width:150px', ...pill]),
  ].join(';')
  const metaEl = meta ? document.createElement('span') : null
  if (metaEl) metaEl.textContent = meta
  const nameEl = document.createElement('span')
  nameEl.textContent = name
  if (face) {
    // A person or agent: the avatar is the head on the column, one line beside it.
    face.style.width = face.style.height = `${HEAD}px`
    face.style.borderRadius = '999px'
    face.style.boxShadow = '0 1px 3px rgb(0 0 0 / 0.35)'
    const row = document.createElement('span')
    row.style.cssText = 'display:flex;align-items:center;gap:6px'
    const line = document.createElement('span')
    line.style.cssText = ['display:block', 'max-width:190px', 'overflow:hidden', 'text-overflow:ellipsis', ...pill].join(';')
    line.appendChild(nameEl)
    if (metaEl) {
      metaEl.textContent = ` · ${meta}`
      metaEl.style.cssText = `font-weight:500;opacity:0.7;${metaColor ? `color:${metaColor};opacity:1` : ''}`
      line.appendChild(metaEl)
    }
    row.append(face, line)
    el.appendChild(row)
  } else {
    // CSS2DRenderer resets `display` on the element it positions, so the two lines are block spans.
    nameEl.style.cssText = 'display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis'
    el.appendChild(nameEl)
    if (metaEl) {
      metaEl.style.cssText = `display:block;font-weight:500;font-size:10px;line-height:12px;opacity:0.75;${metaColor ? `color:${metaColor};opacity:1` : ''}`
      el.appendChild(metaEl)
    }
  }
  el.addEventListener('mouseenter', handlers.onEnter)
  el.addEventListener('mouseleave', handlers.onLeave)
  el.addEventListener('focus', handlers.onEnter)
  el.addEventListener('blur', handlers.onLeave)
  el.addEventListener('click', handlers.onClick)
  const object = new CSS2DObject(el)
  if (face) object.center.set(0, 1)
  else object.center.set(0.5, 1)
  return { object, el, dx: face ? -HEAD / 2 : 0 }
}

/** `dx`: pixels the chip is shifted from its anchor, so the head sits on the column. */
export type ChipSlot = { object: CSS2DObject; el: HTMLElement; priority: number; dx?: number }

const GAP = 3
const MAX_LIFT = 120
const point = new THREE.Vector3()

/**
 * Lifts chips that would cover a chip with a higher priority, so every name stays readable.
 * Positions are screen pixels; the anchor of a chip follows its `center`.
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
    const left = x - slot.object.center.x * w + (slot.dx ?? 0)
    let lift = 0
    for (let guard = 0; guard < 8; guard++) {
      const l = left
      const r = left + w
      const b = y - lift
      const t = b - h
      const hit = placed.find((p) => l < p.r && r > p.l && t < p.b && b > p.t)
      if (!hit || lift >= MAX_LIFT) break
      lift = Math.min(MAX_LIFT, y - hit.t + GAP)
    }
    placed.push({ l: left, r: left + w, t: y - lift - h, b: y - lift })
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
