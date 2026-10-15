/**
 * Live Bokito orb for the chat widget — same silhouette + gaze/blink feel as
 * dashboard BotOrbAvatar (vanilla, no React). Fill defaults to brand mint.
 */

import { DEFAULT_BRAND_HEX } from '@bokito/shared'

/** Brand green for Bokito; tenants may override via --bk-orb-fill / --bk-primary. */
export const BOKITO_ORB_COLOR = DEFAULT_BRAND_HEX

const UNDER =
  'M3.023 22.273C3.861 29.342 8.728 34.576 13.893 33.963C19.059 33.351 22.567 27.125 21.729 20.056C20.892 12.988 16.025 7.754 10.859 8.366C5.694 8.978 2.186 15.205 3.023 22.273ZM61.005 22.273C60.167 29.342 55.300 34.576 50.135 33.963C44.969 33.351 41.461 27.125 42.299 20.056C43.137 12.988 48.003 7.754 53.169 8.366C58.334 8.978 61.843 15.205 61.005 22.273Z'
const SHADE =
  'M7.607 24.271C8.285 29.985 12.219 34.216 16.394 33.721C20.570 33.226 23.406 28.192 22.729 22.478C22.052 16.764 18.117 12.533 13.942 13.028C9.766 13.523 6.930 18.556 7.607 24.271ZM56.421 24.271C55.744 29.985 51.809 34.216 47.634 33.721C43.458 33.226 40.622 28.192 41.299 22.478C41.977 16.764 45.911 12.533 50.086 13.028C54.262 13.523 57.098 18.556 56.421 24.271Z'
const BODY =
  'M51.993 29.846C51.993 42.322 43.069 52.435 32.059 52.435C21.050 52.435 12.125 42.322 12.125 29.846C12.125 17.371 21.050 7.257 32.059 7.257C43.069 7.257 51.993 17.371 51.993 29.846ZM51.292 42.318C51.292 50.284 42.659 56.743 32.009 56.743C21.359 56.743 12.726 50.284 12.726 42.318C12.726 34.351 21.359 27.893 32.009 27.893C42.659 27.893 51.292 34.351 51.292 42.318Z'
const NOSE_L =
  'M31.037 36.191L29.331 33.765C28.881 33.124 27.903 33.224 27.592 33.943L27.236 34.766C27.132 35.008 27.232 35.290 27.466 35.410L30.397 36.924C30.862 37.164 31.338 36.620 31.037 36.191Z'
const NOSE_R =
  'M33.132 36.191L34.837 33.765C35.287 33.124 36.265 33.224 36.576 33.943L36.932 34.766C37.037 35.008 36.936 35.290 36.702 35.410L33.771 36.924C33.306 37.164 32.831 36.620 33.132 36.191Z'

const FILL = `var(--bk-orb-fill, var(--bk-primary, ${BOKITO_ORB_COLOR}))`
/** Inner-ear / nostril shade — same mix as BotOrbAvatar (SVG #7A00E5 on #8600FB). */
const SHADE_FILL = `color-mix(in srgb, ${FILL} 90%, #000)`
const DETAIL_FILL = `color-mix(in srgb, ${FILL} 82%, #000)`
const GAZE_MAX_X = 9.2
const GAZE_MAX_Y = 6.4
const PROXIMITY_PX = 200
const MS_TRACK = 90
const MS_SETTLE = 520
const MS_LOOK = 580
const EYE_TILT_MAX = 11
const EYE_SQUASH_MAX = 0.34
const EYE_WIDEN_MAX = 0.1
const NOSE_PARALLAX_X = 0.68
const NOSE_PARALLAX_Y = 0.62
const NOSE_SEP = 0.28
const NOSE_TILT_MAX = 6
const NOSE_SQUASH_MAX = 0.18

type Gaze = { x: number; y: number }

const LOOKS: Gaze[] = [
  { x: -5.4, y: 0 },
  { x: 5.4, y: 0 },
  { x: 0, y: -4.2 },
  { x: 0, y: 3.4 },
  { x: -4.8, y: -2.8 },
  { x: 4.8, y: -2.8 },
]

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

function distanceToRect(clientX: number, clientY: number, rect: DOMRect): number {
  const dx = Math.max(rect.left - clientX, 0, clientX - rect.right)
  const dy = Math.max(rect.top - clientY, 0, clientY - rect.bottom)
  return Math.hypot(dx, dy)
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function orbInnerHtml(): string {
  return `
    <g class="bk-orb__body">
      <path fill="${FILL}" fill-rule="nonzero" d="${UNDER}"/>
      <path class="bk-orb__ear-inner" fill="${SHADE_FILL}" fill-rule="nonzero" d="${SHADE}"/>
      <path fill="${FILL}" fill-rule="nonzero" d="${BODY}"/>
    </g>
    <g class="bk-orb__gaze" style="transform-box:view-box;transform-origin:32px 31px;transition:transform ${MS_SETTLE}ms ease">
      <path class="bk-orb__nostril" fill="${DETAIL_FILL}" fill-rule="nonzero" d="${NOSE_L}" style="transform-origin:29.2px 35.2px;transform-box:view-box;transition:transform ${MS_SETTLE}ms ease"/>
      <path class="bk-orb__nostril bk-orb__nostril--r" fill="${DETAIL_FILL}" fill-rule="nonzero" d="${NOSE_R}" style="transform-origin:34.9px 35.2px;transform-box:view-box;transition:transform ${MS_SETTLE}ms ease"/>
      <g class="bk-orb__face" style="transform:translate(0px,-5.5px) scale(0.92);transform-origin:32px 30px;transform-box:view-box">
        <g class="bk-orb__eyes" style="transform-box:view-box;transform-origin:32px 31px;transition:transform ${MS_SETTLE}ms ease">
          <rect class="bk-orb__eye" x="19.2" y="25.5" width="7.2" height="11" rx="3.6" fill="#fff" style="transform-box:fill-box;transform-origin:50% 50%;transition:transform .12s ease"/>
          <rect class="bk-orb__eye bk-orb__eye--r" x="37.6" y="25.5" width="7.2" height="11" rx="3.6" fill="#fff" style="transform-box:fill-box;transform-origin:50% 50%;transition:transform .12s ease"/>
        </g>
      </g>
    </g>
  `.replace(/\s+/g, ' ').trim()
}

/** Header / message mark. */
export function bokitoOrbMarkHtml(className = 'bk-avatar-logo bk-orb-mark'): string {
  return `<svg class="${className}" viewBox="0 0 64 64" fill="none" aria-hidden="true">${orbInnerHtml()}</svg>`
}

/** Launcher mark (fills the transparent bubble). */
export function bokitoOrbLauncherHtml(): string {
  return `<svg class="bk-launcher-icon bk-launcher-icon--chat bk-launcher-icon--bokito bk-orb-mark" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${orbInnerHtml()}</svg>`
}

export const BOKITO_MARK = bokitoOrbMarkHtml()
export const BOKITO_LAUNCHER_MARK = bokitoOrbLauncherHtml()
/** @deprecated */
export const MONKEY_MARK = BOKITO_MARK

export type LiveOrbHandle = { destroy: () => void; setPaused: (paused: boolean) => void }

type LiveOrbOpts = {
  /** Element used for proximity (launcher button). Defaults to the SVG. */
  proximityEl?: HTMLElement | null
  /** Skip idle look / track when true (e.g. window open → close icon). */
  paused?: boolean
}

/**
 * Attach platform-like idle blink + mouse gaze to an orb SVG already in the DOM.
 */
export function attachLiveOrb(svg: SVGElement, opts: LiveOrbOpts = {}): LiveOrbHandle {
  const proximityEl = opts.proximityEl ?? (svg as unknown as HTMLElement)
  const gazeEl = svg.querySelector<SVGGElement>('.bk-orb__gaze')
  const eyesEl = svg.querySelector<SVGGElement>('.bk-orb__eyes')
  const nostrils = Array.from(svg.querySelectorAll<SVGPathElement>('.bk-orb__nostril'))
  const eyeRects = Array.from(svg.querySelectorAll<SVGRectElement>('.bk-orb__eye'))
  if (!gazeEl || !eyesEl) {
    return { destroy() {}, setPaused() {} }
  }

  let paused = Boolean(opts.paused) || prefersReducedMotion()
  let tracking = false
  let gaze: Gaze = { x: 0, y: 0 }
  let gazeMs = MS_SETTLE
  let raf = 0
  let pending: { x: number; y: number } | null = null
  let idleTimer = 0
  let destroyed = false

  const ease =
    () => (gazeMs >= MS_SETTLE ? 'cubic-bezier(0.22, 1, 0.36, 1)' : 'ease')

  const applyGaze = () => {
    const nx = clamp(gaze.x / GAZE_MAX_X, -1, 1)
    const ny = clamp(gaze.y / GAZE_MAX_Y, -1, 1)
    const absNy = Math.abs(ny)
    const tilt = -nx * ny * EYE_TILT_MAX
    const scaleY = 1 - absNy * EYE_SQUASH_MAX
    const scaleX = 1 + absNy * EYE_WIDEN_MAX
    const timing = ease()
    gazeEl.style.transitionDuration = `${gazeMs}ms`
    gazeEl.style.transitionTimingFunction = timing
    gazeEl.style.transform = `translate(${gaze.x}px, ${gaze.y}px)`
    eyesEl.style.transitionDuration = `${gazeMs}ms`
    eyesEl.style.transitionTimingFunction = timing
    eyesEl.style.transform = `rotate(${tilt}deg) scale(${scaleX}, ${scaleY})`
    nostrils.forEach((n, i) => {
      const side = i === 0 ? -1 : 1
      const toward = side * nx
      const nxAbs = Math.abs(nx)
      // Relative to gaze group (same lag formula as BotOrbAvatar).
      const px = gaze.x * NOSE_PARALLAX_X + toward * NOSE_SEP - gaze.x
      const py = gaze.y * NOSE_PARALLAX_Y - gaze.y
      const nTilt = -nx * ny * NOSE_TILT_MAX
      const nSx = 1 + toward * 0.16 - nxAbs * 0.05
      const nSy = 1 - absNy * NOSE_SQUASH_MAX + toward * 0.05
      n.style.transitionDuration = `${gazeMs}ms`
      n.style.transitionTimingFunction = timing
      n.style.transform = `translate(${px}px, ${py}px) rotate(${nTilt}deg) scale(${nSx}, ${nSy})`
    })
  }

  const moveGaze = (next: Gaze, ms: number) => {
    gazeMs = ms
    gaze = next
    applyGaze()
  }

  const blink = async () => {
    eyeRects.forEach((e) => {
      e.style.transform = 'scaleY(0.08)'
    })
    await sleep(220)
    if (destroyed) return
    eyeRects.forEach((e) => {
      e.style.transform = 'scaleY(1)'
    })
  }

  const scheduleIdle = () => {
    if (paused || tracking || destroyed || prefersReducedMotion()) return
    window.clearTimeout(idleTimer)
    idleTimer = window.setTimeout(() => {
      void (async () => {
        if (paused || tracking || destroyed) return
        const roll = Math.random()
        if (roll < 0.45) {
          await blink()
        } else {
          const look = LOOKS[Math.floor(Math.random() * LOOKS.length)]!
          moveGaze(look, MS_LOOK)
          await sleep(700 + Math.random() * 400)
          if (!tracking && !paused) moveGaze({ x: 0, y: 0 }, MS_SETTLE)
        }
        scheduleIdle()
      })()
    }, 1600 + Math.random() * 3200)
  }

  const onPointer = (clientX: number, clientY: number) => {
    if (paused || destroyed || prefersReducedMotion()) return
    const rect = proximityEl.getBoundingClientRect()
    const dist = distanceToRect(clientX, clientY, rect)
    if (dist > PROXIMITY_PX) {
      if (tracking) {
        tracking = false
        moveGaze({ x: 0, y: 0 }, MS_SETTLE)
        scheduleIdle()
      }
      return
    }
    if (!tracking) {
      tracking = true
      window.clearTimeout(idleTimer)
    }
    const halfW = Math.max(rect.width / 2, 1)
    const halfH = Math.max(rect.height / 2, 1)
    const nx = clamp((clientX - (rect.left + halfW)) / halfW, -1, 1)
    const ny = clamp((clientY - (rect.top + halfH)) / halfH, -1, 1)
    const pull = dist <= 0 ? 1 : clamp(1 - dist / PROXIMITY_PX, 0.35, 1)
    moveGaze({ x: nx * GAZE_MAX_X * pull, y: ny * GAZE_MAX_Y * pull }, MS_TRACK)
  }

  const flush = () => {
    raf = 0
    const p = pending
    pending = null
    if (p) onPointer(p.x, p.y)
  }

  const onMove = (e: PointerEvent) => {
    pending = { x: e.clientX, y: e.clientY }
    if (!raf) raf = window.requestAnimationFrame(flush)
  }

  window.addEventListener('pointermove', onMove, { passive: true })
  applyGaze()
  scheduleIdle()

  return {
    setPaused(next: boolean) {
      paused = next || prefersReducedMotion()
      if (paused) {
        tracking = false
        window.clearTimeout(idleTimer)
        moveGaze({ x: 0, y: 0 }, MS_SETTLE)
        eyeRects.forEach((e) => {
          e.style.transform = 'scaleY(1)'
        })
      } else {
        scheduleIdle()
      }
    },
    destroy() {
      destroyed = true
      window.removeEventListener('pointermove', onMove)
      window.clearTimeout(idleTimer)
      if (raf) window.cancelAnimationFrame(raf)
    },
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms))
}
