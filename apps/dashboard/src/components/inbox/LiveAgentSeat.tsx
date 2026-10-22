import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { BotOrbMotion } from '../../lib/bot-orb-motion'
import type { AgentPresenceStatus } from '../../lib/teams-api'
import { cn } from '../../lib/utils'
import { AiAvatar, type AiAvatarMode } from '../ui/AiAvatar'
import { AgentDoneCorner } from '../ui/AgentDoneCorner'
import { CHAT_AVATAR_SIZE } from './ThreadMeta'
import type { AgentAvatarKind } from '../../lib/agent-avatar'
import { subscribeLiveGlowPace } from '../../lib/live-glow-pace'

type SeatClaim = {
  slotId: string
  spawnKey: string | null
}

/** Full ground-rise vs in-place grow when relocating from a live seat. */
export type AgentSpawnStyle = 'full' | 'quick'

const FULL_SPAWN_MS = 1550
const QUICK_SPAWN_MS = 480
/** No thread activity for this long → last sender's orb goes static. */
export const IDLE_ORB_MS = 2 * 60 * 1000

type LiveAgentSeatContextValue = {
  claimSeat: (agentId: string, slotId: string, opts?: { spawn?: boolean }) => void
  releaseSeat: (agentId: string) => void
  /** Drop the claim after a short beat so a same-agent remount can keep the spawn. */
  scheduleReleaseSeat: (agentId: string) => void
  /** Release only when this slot still owns the claim (safe unmount cleanup). */
  releaseSeatIfSlot: (agentId: string, slotId: string) => void
  /** Drop a parked `msg:` seat only (never a live turn `live:` seat). */
  releaseMessageSeat: (agentId: string) => void
  /** Only this agent stays live; others become static footprints. */
  setFocusAgent: (agentId: string | null) => void
  focusedAgentId: string | null
  isLiveSlot: (agentId: string, slotId: string) => boolean
  /** Current live slot id for an agent, if any. */
  slotIdFor: (agentId: string) => string | null
  spawnKeyFor: (agentId: string) => string | null
  /** True while the live orb is still playing its entrance (full or quick). */
  isEntering: (agentId: string) => boolean
  registerSlotEl: (agentId: string, slotId: string, el: HTMLElement | null) => void
}

const LiveAgentSeatContext = createContext<LiveAgentSeatContextValue | null>(null)

function slotKey(agentId: string, slotId: string) {
  return `${agentId}::${slotId}`
}

/**
 * Per open thread: at most one live orb seat per agent. Non-owned slots stay
 * static footprints with a done check. Unmount (leave thread) clears claims.
 *
 * Entrances:
 * - No prior live seat + spawn requested → full ground rise
 * - Relocate from an existing live seat (unless spawn:false) → quick grow-in-place
 * - spawn:false → silent claim (idle park on last bubble / rejoin user's turn)
 */
export function LiveAgentSeatProvider({ children }: { children: ReactNode }) {
  const [claims, setClaims] = useState<Record<string, SeatClaim>>({})
  const [enteringUntil, setEnteringUntil] = useState<Record<string, number>>({})
  const enteringUntilRef = useRef(enteringUntil)
  enteringUntilRef.current = enteringUntil
  const [focusedAgentId, setFocusedAgentId] = useState<string | null>(null)
  const claimsRef = useRef(claims)
  claimsRef.current = claims
  const slotsRef = useRef(new Map<string, HTMLElement>())
  const spawnSeq = useRef(0)
  const enterTimersRef = useRef(new Map<string, number>())
  const releaseTimersRef = useRef(new Map<string, number>())

  useEffect(() => {
    return () => {
      for (const id of enterTimersRef.current.values()) window.clearTimeout(id)
      enterTimersRef.current.clear()
    }
  }, [])

  const markEntering = useCallback((agentId: string, style: AgentSpawnStyle) => {
    const ms = style === 'quick' ? QUICK_SPAWN_MS : FULL_SPAWN_MS
    const until = Date.now() + ms
    setEnteringUntil((prev) => (prev[agentId] === until ? prev : { ...prev, [agentId]: until }))
    const prevTimer = enterTimersRef.current.get(agentId)
    if (prevTimer) window.clearTimeout(prevTimer)
    const timer = window.setTimeout(() => {
      enterTimersRef.current.delete(agentId)
      setEnteringUntil((prev) => {
        if (!(agentId in prev)) return prev
        const next = { ...prev }
        delete next[agentId]
        return next
      })
    }, ms)
    enterTimersRef.current.set(agentId, timer)
  }, [])

  const clearEntering = useCallback((agentId: string) => {
    const timer = enterTimersRef.current.get(agentId)
    if (timer) {
      window.clearTimeout(timer)
      enterTimersRef.current.delete(agentId)
    }
    setEnteringUntil((prev) => {
      if (!(agentId in prev)) return prev
      const next = { ...prev }
      delete next[agentId]
      return next
    })
  }, [])

  const registerSlotEl = useCallback(
    (agentId: string, slotId: string, el: HTMLElement | null) => {
      const key = slotKey(agentId, slotId)
      if (el) {
        slotsRef.current.set(key, el)
        return
      }
      slotsRef.current.delete(key)
    },
    [],
  )

  const claimSeat = useCallback(
    (agentId: string, slotId: string, opts?: { spawn?: boolean }) => {
      if (!agentId || !slotId) return
      const pendingRelease = releaseTimersRef.current.get(agentId)
      if (pendingRelease) {
        window.clearTimeout(pendingRelease)
        releaseTimersRef.current.delete(agentId)
      }
      const existing = claimsRef.current[agentId]
      // Same seat: never re-bump spawnKey (effect re-runs used to infinite-loop),
      // except upgrade a silent claim when an entrance is now requested.
      if (existing?.slotId === slotId) {
        if (opts?.spawn === true && !existing.spawnKey) {
          const spawnedStyle: AgentSpawnStyle = 'full'
          const nextSpawnKey = `full-${agentId}-${++spawnSeq.current}`
          const nextClaim = { slotId, spawnKey: nextSpawnKey }
          claimsRef.current = { ...claimsRef.current, [agentId]: nextClaim }
          setClaims((prev) => ({ ...prev, [agentId]: nextClaim }))
          markEntering(agentId, spawnedStyle)
        }
        return
      }

      // Entrance already playing: only move the seat. A new spawnKey restarts
      // the rise (activity/speech/stream id used to do that ~10 times).
      const stillEntering = (enteringUntilRef.current[agentId] ?? 0) > Date.now()
      if (existing && stillEntering) {
        const nextClaim = { slotId, spawnKey: existing.spawnKey }
        claimsRef.current = { ...claimsRef.current, [agentId]: nextClaim }
        setClaims((prev) => ({ ...prev, [agentId]: nextClaim }))
        return
      }

      let nextSpawnKey = existing?.spawnKey ?? null
      let spawnedStyle: AgentSpawnStyle | null = null

      if (opts?.spawn === false) {
        // Silent relocate / idle park — keep prior key so remounts do not re-animate.
      } else if (existing?.spawnKey) {
        // Already rose this visit — later seats stay put (no second grow).
      } else if (existing) {
        // Living avatar already in this thread → grow in at the new seat.
        spawnedStyle = 'quick'
        nextSpawnKey = `quick-${agentId}-${++spawnSeq.current}`
      } else if (opts?.spawn === true) {
        // First live appearance (Ask / rejoin mid-turn) → full ground rise.
        spawnedStyle = 'full'
        nextSpawnKey = `full-${agentId}-${++spawnSeq.current}`
      }

      const nextClaim = { slotId, spawnKey: nextSpawnKey }
      // Keep claimsRef in sync before the next paint so effect cleanup+setup
      // in the same tick cannot release a seat that claimSeat just “kept”.
      claimsRef.current = { ...claimsRef.current, [agentId]: nextClaim }
      setClaims((prev) => ({
        ...prev,
        [agentId]: nextClaim,
      }))
      if (spawnedStyle) markEntering(agentId, spawnedStyle)
    },
    [markEntering],
  )

  const releaseSeat = useCallback(
    (agentId: string) => {
      const pendingRelease = releaseTimersRef.current.get(agentId)
      if (pendingRelease) {
        window.clearTimeout(pendingRelease)
        releaseTimersRef.current.delete(agentId)
      }
      if (!(agentId in claimsRef.current)) {
        clearEntering(agentId)
        return
      }
      const next = { ...claimsRef.current }
      delete next[agentId]
      claimsRef.current = next
      setClaims(next)
      clearEntering(agentId)
    },
    [clearEntering],
  )

  /** Unmount often remounts the same agent one frame later (row swap). */
  const scheduleReleaseSeat = useCallback(
    (agentId: string) => {
      if (!agentId) return
      const prev = releaseTimersRef.current.get(agentId)
      if (prev) window.clearTimeout(prev)
      const timer = window.setTimeout(() => {
        releaseTimersRef.current.delete(agentId)
        releaseSeat(agentId)
      }, 64)
      releaseTimersRef.current.set(agentId, timer)
    },
    [releaseSeat],
  )

  const releaseSeatIfSlot = useCallback(
    (agentId: string, slotId: string) => {
      if (claimsRef.current[agentId]?.slotId !== slotId) return
      releaseSeat(agentId)
    },
    [releaseSeat],
  )

  const releaseMessageSeat = useCallback(
    (agentId: string) => {
      const slot = claimsRef.current[agentId]?.slotId
      if (!slot || !slot.startsWith('msg:')) return
      releaseSeat(agentId)
    },
    [releaseSeat],
  )

  const setFocusAgent = useCallback(
    (agentId: string | null) => {
      setFocusedAgentId(agentId)
      if (!agentId) return
      for (const [id, claim] of Object.entries(claimsRef.current)) {
        if (id === agentId) continue
        // Never drop an in-flight turn seat (Nadenken / streaming).
        if (claim.slotId.startsWith('live:')) continue
        releaseSeat(id)
      }
    },
    [releaseSeat],
  )

  const isLiveSlot = useCallback(
    (agentId: string, slotId: string) => {
      // Focus only gates decorative peers — a claimed live:/ turn seat must
      // stay live even if Ask-tab focus points at another agent.
      const claimed = claims[agentId]?.slotId === slotId
      if (!claimed) return false
      if (slotId.startsWith('live:')) return true
      if (focusedAgentId && agentId !== focusedAgentId) return false
      return true
    },
    [claims, focusedAgentId],
  )

  const slotIdFor = useCallback(
    (agentId: string) => claims[agentId]?.slotId ?? null,
    [claims],
  )

  const spawnKeyFor = useCallback(
    (agentId: string) => claims[agentId]?.spawnKey ?? null,
    [claims],
  )

  const isEntering = useCallback(
    (agentId: string) => (enteringUntil[agentId] ?? 0) > Date.now(),
    [enteringUntil],
  )

  const value = useMemo(
    () => ({
      claimSeat,
      releaseSeat,
      scheduleReleaseSeat,
      releaseSeatIfSlot,
      releaseMessageSeat,
      setFocusAgent,
      focusedAgentId,
      isLiveSlot,
      slotIdFor,
      spawnKeyFor,
      isEntering,
      registerSlotEl,
    }),
    [
      claimSeat,
      releaseSeat,
      scheduleReleaseSeat,
      releaseSeatIfSlot,
      releaseMessageSeat,
      setFocusAgent,
      focusedAgentId,
      isLiveSlot,
      slotIdFor,
      spawnKeyFor,
      isEntering,
      registerSlotEl,
    ],
  )

  return (
    <LiveAgentSeatContext.Provider value={value}>{children}</LiveAgentSeatContext.Provider>
  )
}

/** Sync composer / speaking agent focus into the seat provider. */
export function SyncLiveAgentFocus({ agentId }: { agentId: string | null }) {
  const seat = useLiveAgentSeat()
  // Depend on the stable callback — the whole seat value object changes on
  // every claim/focus update and would re-fire this effect forever.
  const setFocusAgent = seat?.setFocusAgent
  useEffect(() => {
    setFocusAgent?.(agentId)
  }, [setFocusAgent, agentId])
  return null
}

export function useLiveAgentSeat(): LiveAgentSeatContextValue | null {
  return useContext(LiveAgentSeatContext)
}

/**
 * Park the live idle orb on the latest agent bubble while it is the user's
 * turn. Silent claim (no spawn). After {@link IDLE_ORB_MS} without a newer
 * message the seat drops and the mark goes static. The next live turn then
 * full-spawns because there is no prior seat. A user reply also releases
 * the park. Does not release when a live turn steals the seat.
 */
export function ClaimIdleAgentSeat({
  agentId,
  messageId,
  activityAt,
  release = false,
}: {
  agentId: string | null | undefined
  messageId: string | null | undefined
  /** When that bubble was sent. Already-stale threads stay static. */
  activityAt?: string | null
  /** True when the latest message is the user's — drop the parked idle seat. */
  release?: boolean
}) {
  const seat = useLiveAgentSeat()
  const claimSeat = seat?.claimSeat
  const releaseMessageSeat = seat?.releaseMessageSeat
  useEffect(() => {
    if (!agentId) return
    const id = String(agentId)
    if (!messageId) {
      if (release) releaseMessageSeat?.(id)
      return
    }
    const at = activityAt ? Date.parse(activityAt) : Date.now()
    const elapsed = Date.now() - (Number.isFinite(at) ? at : Date.now())
    if (elapsed >= IDLE_ORB_MS) {
      releaseMessageSeat?.(id)
      return
    }
    claimSeat?.(id, `msg:${messageId}`, { spawn: false })
    const timer = window.setTimeout(() => {
      releaseMessageSeat?.(id)
    }, IDLE_ORB_MS - elapsed)
    return () => window.clearTimeout(timer)
  }, [claimSeat, releaseMessageSeat, agentId, messageId, activityAt, release])
  return null
}

export type LiveAgentAvatarSlotProps = {
  agentId: string
  slotId: string
  size?: number
  className?: string
  name?: string | null
  kind?: AgentAvatarKind | string | null
  icon?: string | null
  color?: string | null
  shape?: string | null
  imageUrl?: string | null
  decorative?: boolean
  activity?: AgentPresenceStatus | null
  motion?: BotOrbMotion | null
  pulseId?: string | null
  baseMotion?: BotOrbMotion | null
  /**
   * Claim this slot on mount / when agentId+slotId change.
   * Use for the active turn seat and the post-turn latest bubble.
   */
  claim?: boolean
  /**
   * `true` = request entrance (full if no prior live seat, quick if relocating).
   * `false` = silent claim.
   * omit = relocate from a live seat still quickspawns; first claim stays quiet.
   */
  spawn?: boolean
  /** Force static even if this slot holds the live claim (unused footprint under portal). */
  forceStatic?: boolean
}

/**
 * Thread avatar slot: static footprint by default; live (+ spawn) when this
 * slot owns the agent's seat. Checkmark animates in on live → static.
 */
export function LiveAgentAvatarSlot({
  agentId,
  slotId,
  size = CHAT_AVATAR_SIZE,
  className,
  claim = false,
  spawn,
  forceStatic = false,
  activity,
  motion,
  pulseId,
  baseMotion,
  ...avatarProps
}: LiveAgentAvatarSlotProps) {
  const seat = useLiveAgentSeat()
  const rootRef = useRef<HTMLSpanElement>(null)
  const live = Boolean(seat && !forceStatic && seat.isLiveSlot(agentId, slotId))
  const spawnKey = live ? seat?.spawnKeyFor(agentId) : null
  const mode: AiAvatarMode = live ? 'live' : 'static'
  const claimSeat = seat?.claimSeat
  const registerSlotEl = seat?.registerSlotEl
  const wasLiveRef = useRef(live)
  const [checkEnter, setCheckEnter] = useState(false)
  // Only footprints that were actually live get a done check — never a
  // thinking seat that lost the claim (or never held it).
  const [showDone, setShowDone] = useState(false)

  useEffect(() => {
    if (wasLiveRef.current && !live) {
      setCheckEnter(true)
      setShowDone(true)
    }
    if (live) {
      setCheckEnter(false)
      setShowDone(false)
    }
    wasLiveRef.current = live
  }, [live])

  useEffect(() => {
    if (!registerSlotEl || !agentId) return
    registerSlotEl(agentId, slotId, rootRef.current)
    return () => registerSlotEl(agentId, slotId, null)
  }, [registerSlotEl, agentId, slotId])

  const scheduleReleaseSeat = seat?.scheduleReleaseSeat
  useEffect(() => {
    const el = rootRef.current
    if (!live || !el) return
    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      el.style.setProperty('--live-pace', '0.2')
      return
    }
    let target = 0
    let current = 0
    let staleAt = performance.now()
    const unsubscribe = subscribeLiveGlowPace((next) => {
      target = Math.min(1.8, next)
      staleAt = performance.now()
    })
    let frame = 0
    const tick = (now: number) => {
      if (now - staleAt > 240) target *= 0.9
      current += (target - current) * 0.1
      el.style.setProperty('--live-pace', current.toFixed(3))
      frame = window.requestAnimationFrame(tick)
    }
    frame = window.requestAnimationFrame(tick)
    return () => {
      window.cancelAnimationFrame(frame)
      unsubscribe()
    }
  }, [live])
  // Capture spawn for this claim tick without putting it in effect deps (a
  // true→false flip on the same slot used to cleanup-release then no-op
  // reclaim and left a static checkmark mid-tool).
  const spawnRef = useRef(spawn)
  spawnRef.current = spawn
  // One entrance per agent while this slot component stays mounted. Reset when
  // agentId changes (handoff Extra) so a late agentId still gets a full rise.
  const entranceForAgentRef = useRef<string | null>(null)
  const entranceDoneRef = useRef(false)
  useEffect(() => {
    if (!claimSeat || !claim || !agentId) return
    if (entranceForAgentRef.current !== agentId) {
      entranceForAgentRef.current = agentId
      entranceDoneRef.current = false
    }
    const spawnOpt = spawnRef.current
    const isTurnSeat = slotId.startsWith('live:')
    // Turn seats default to an entrance on first claim for this agent. Omit
    // still quickspawns on relocate (existing seat); spawn:false stays silent.
    const wantEntrance =
      spawnOpt === true || (spawnOpt !== false && isTurnSeat && !entranceDoneRef.current)
    if (wantEntrance) entranceDoneRef.current = true
    const opts =
      spawnOpt === false
        ? { spawn: false }
        : wantEntrance
          ? { spawn: true }
          : undefined
    claimSeat(agentId, slotId, opts)
  }, [claimSeat, claim, agentId, slotId])

  // Drop the live seat only when this claiming overlay unmounts or the agent
  // changes — not when slotId moves activity→speech (that must keep `existing`
  // so claimSeat quickspawns instead of a second full rise / silent blank key).
  const claimingLiveSeat = Boolean(claim && agentId && slotId.startsWith('live:'))
  useEffect(() => {
    if (!claimingLiveSeat || !agentId || !scheduleReleaseSeat) return
    const tracked = agentId
    return () => {
      scheduleReleaseSeat(tracked)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- omit slotId on purpose
  }, [claimingLiveSeat, agentId, scheduleReleaseSeat])

  // Saved message footprints always show done when static. Relying only on
  // wasLive→static missed agents whose live seat lived on `live:` (Ask) and
  // never on `msg:` before another agent took the floor.
  const showDoneMark = !live && (showDone || slotId.startsWith('msg:'))
  // A turn seat paints static until the claim effect runs, which reads as the
  // agent popping in fully and only then rising. Hold the mark until live.
  const holdForSpawn = claim && spawn !== false && slotId.startsWith('live:') && !live

  return (
    <span
      ref={rootRef}
      className={cn('relative inline-flex shrink-0', className)}
      style={{ width: size, height: size }}
      data-live-agent-slot={slotId}
      data-live-agent={live ? 'true' : undefined}
    >
      {holdForSpawn ? null : (
        <span className="live-agent-face inline-flex" data-live={live || undefined}>
          <AiAvatar
            {...avatarProps}
            size={size}
            mode={mode}
            spawnKey={spawnKey}
            // Live seat: face mood only — no presence corner (orb chrome is enough).
            activity={live ? undefined : activity}
            motion={live ? motion : undefined}
            pulseId={live ? pulseId : undefined}
            baseMotion={live ? baseMotion : undefined}
          />
        </span>
      )}
      {showDoneMark ? <AgentDoneCorner size={size} enter={checkEnter || showDone} /> : null}
    </span>
  )
}
