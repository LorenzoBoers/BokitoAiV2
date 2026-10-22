import { useEffect, useRef } from 'react'
import { useTheme } from '../../context/ThemeContext'
import { isBotOrbMotion, type BotOrbMotion } from '../../lib/bot-orb-motion'

/**
 * Quiet dot lattice behind a page. Near the pointer and around the live agent
 * seat, dots drift off the grid and orbit in their own tilted 3D plane. Around
 * the agent the reach, speed and brightness follow its mood, so the field
 * breathes with what the agent is doing. Dots only brighten in their own ink.
 */

type Field = { reach: number; speed: number; amp: number; breath: number }

const GAP = 28
const OFF: Field = { reach: 0, speed: 0, amp: 0, breath: 0 }
const POINTER: Field = { reach: 90, speed: 0.5, amp: 0.35, breath: 0 }

const AGENT_FIELD: Record<BotOrbMotion, Field> = {
  idle: { reach: 85, speed: 0.22, amp: 0.3, breath: 0.25 },
  listening: { reach: 95, speed: 0.35, amp: 0.35, breath: 0.33 },
  thinking: { reach: 125, speed: 0.6, amp: 0.5, breath: 0.5 },
  searching: { reach: 140, speed: 0.85, amp: 0.55, breath: 0.6 },
  writing: { reach: 115, speed: 0.5, amp: 0.45, breath: 0.7 },
  sending: { reach: 135, speed: 0.95, amp: 0.5, breath: 0.75 },
  working: { reach: 150, speed: 0.75, amp: 0.6, breath: 0.38 },
  sleeping: { reach: 55, speed: 0.08, amp: 0.15, breath: 0.18 },
  yes: { reach: 165, speed: 1.1, amp: 0.65, breath: 1 },
  no: { reach: 115, speed: 0.6, amp: 0.45, breath: 0.8 },
  alert: { reach: 130, speed: 1.3, amp: 0.6, breath: 1.6 },
  jump: { reach: 160, speed: 1.1, amp: 0.6, breath: 1 },
  done: { reach: 165, speed: 1, amp: 0.65, breath: 0.9 },
  leave: { reach: 150, speed: 1.2, amp: 0.5, breath: 0.9 },
}

type Dot = { x: number; y: number; inc: number; asc: number; phase: number; orbit: number }
type Source = { x: number; y: number; field: Field; clock: number }

function buildGrid(width: number, height: number): Dot[] {
  const dots: Dot[] = []
  for (let y = GAP / 2; y < height; y += GAP) {
    for (let x = GAP / 2; x < width; x += GAP) {
      dots.push({
        x,
        y,
        inc: 0.35 + Math.random() * 1.0,
        asc: Math.random() * Math.PI * 2,
        phase: Math.random() * Math.PI * 2,
        orbit: GAP * (0.2 + Math.random() * 0.22),
      })
    }
  }
  return dots
}

function ease(from: Field, to: Field, k: number): Field {
  return {
    reach: from.reach + (to.reach - from.reach) * k,
    speed: from.speed + (to.speed - from.speed) * k,
    amp: from.amp + (to.amp - from.amp) * k,
    breath: from.breath + (to.breath - from.breath) * k,
  }
}

export function DotGridBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { isDark } = useTheme()

  useEffect(() => {
    const canvas = canvasRef.current
    const parent = canvas?.parentElement
    const ctx = canvas?.getContext('2d')
    if (!canvas || !parent || !ctx) return

    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const ink = isDark ? '255,255,255' : '88,84,78'
    const base = isDark ? 0.09 : 0.13

    let width = 0
    let height = 0
    let dots: Dot[] = []
    const pointer: Source = { x: -9999, y: -9999, field: { ...OFF }, clock: 0 }
    const agent: Source = { x: -9999, y: -9999, field: { ...OFF }, clock: 0 }
    let pointerOn = false
    let seatRadius = 0
    let frame = 0
    let idleTimer = 0
    let last = 0
    let time = 0

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = parent.clientWidth
      height = parent.clientHeight
      canvas.width = Math.max(1, Math.floor(width * dpr))
      canvas.height = Math.max(1, Math.floor(height * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      dots = buildGrid(width, height)
      wake()
    }

    /** Live seat (or a page's featured agent) inside this page, or null. Its orb names the mood. */
    const readAgent = (): { x: number; y: number; radius: number; motion: BotOrbMotion } | null => {
      const seat = parent.querySelector<HTMLElement>('[data-live-agent="true"], [data-dot-field-agent]')
      if (!seat) return null
      const orb = seat.querySelector<HTMLElement>('.bot-orb')
      if (orb?.classList.contains('bot-orb--paused')) return null
      const box = parent.getBoundingClientRect()
      const rect = (orb ?? seat).getBoundingClientRect()
      const x = rect.left + rect.width / 2 - box.left
      const y = rect.top + rect.height / 2 - box.top
      if (x < -200 || y < -200 || x > width + 200 || y > height + 200) return null
      const raw = orb?.getAttribute('data-motion') ?? 'idle'
      const motion: BotOrbMotion = isBotOrbMotion(raw) ? raw : 'idle'
      return { x, y, radius: rect.width / 2, motion }
    }

    const influence = (source: Source, dot: Dot, reach: number) => {
      if (reach <= 1 || source.field.amp <= 0.002) return 0
      const dist = Math.hypot(dot.x - source.x, dot.y - source.y)
      if (dist >= reach) return 0
      const t = 1 - dist / reach
      return t * t * (3 - 2 * t) * source.field.amp
    }

    const draw = (now: number) => {
      frame = 0
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60
      last = now
      time += dt

      const seat = readAgent()
      if (seat) {
        agent.x = seat.x
        agent.y = seat.y
        seatRadius = seat.radius
      }
      agent.field = ease(agent.field, seat ? AGENT_FIELD[seat.motion] : OFF, still ? 1 : 0.04)
      pointer.field = ease(pointer.field, pointerOn ? POINTER : OFF, still ? 1 : 0.07)
      agent.clock += dt * agent.field.speed
      pointer.clock += dt * pointer.field.speed

      const agentReach =
        agent.field.reach > 1
          ? (agent.field.reach + seatRadius) * (1 + 0.1 * Math.sin(time * Math.PI * 2 * agent.field.breath))
          : 0

      ctx.clearRect(0, 0, width, height)
      for (const dot of dots) {
        const fa = influence(agent, dot, agentReach)
        const fp = influence(pointer, dot, pointer.field.reach)
        const f = Math.min(1, fa + fp)
        let x = dot.x
        let y = dot.y
        let depth = 0
        if (f > 0 && !still) {
          const clock = fa >= fp ? agent.clock : pointer.clock
          const theta = dot.phase + clock * Math.PI * 2
          const ox = Math.cos(theta)
          const oy = Math.sin(theta) * Math.cos(dot.inc)
          depth = Math.sin(theta) * Math.sin(dot.inc)
          const ca = Math.cos(dot.asc)
          const sa = Math.sin(dot.asc)
          x += (ox * ca - oy * sa) * dot.orbit * f
          y += (ox * sa + oy * ca) * dot.orbit * f
        }
        const lift = f * (1 + depth * 0.3)
        ctx.beginPath()
        ctx.fillStyle = `rgba(${ink},${base + lift * 0.3})`
        ctx.arc(x, y, 0.95 + lift * 0.9, 0, Math.PI * 2)
        ctx.fill()
      }

      const busy = agent.field.amp > 0.003 || pointer.field.amp > 0.003 || seat || pointerOn
      if (busy && !still) frame = requestAnimationFrame(draw)
      else {
        last = 0
        idleTimer = window.setTimeout(wake, 600)
      }
    }

    function wake() {
      window.clearTimeout(idleTimer)
      if (!frame) frame = requestAnimationFrame(draw)
    }

    const onMove = (event: PointerEvent) => {
      const rect = parent.getBoundingClientRect()
      pointer.x = event.clientX - rect.left
      pointer.y = event.clientY - rect.top
      pointerOn = true
      wake()
    }
    const onLeave = () => {
      pointerOn = false
      wake()
    }

    const observer = new ResizeObserver(resize)
    observer.observe(parent)
    parent.addEventListener('pointermove', onMove)
    parent.addEventListener('pointerleave', onLeave)
    resize()

    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(idleTimer)
      observer.disconnect()
      parent.removeEventListener('pointermove', onMove)
      parent.removeEventListener('pointerleave', onLeave)
    }
  }, [isDark])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  )
}
