import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { onGatewayEvent, type GatewayEvent } from '../lib/gateway'
import { listLiveEntries, onLiveReconnect, useLiveVersion } from '../lib/live-store'
import { hasStoredComposerDraft } from '../lib/inbox-ops'
import { threadIdFromPath } from '../lib/messages-paths'
import { useAgentCallLive } from '../lib/agent-call-live'
import { DOCK_CHANGED_EVENT } from '../lib/dock-agents'
import {
  fetchChatStack,
  nudgeChatStack,
  orderStackCards,
  setChatStackIds,
  stabilizeStackOrder,
  type ChatStackAgent,
  type ChatStackItem,
  type DockSeat,
  type StackCardState,
} from '../lib/chat-stack'
import {
  addFollow,
  pruneFollows,
  removeFollow,
  shouldFollowOnLeave,
  touchFollow,
  updateFollows,
  useFollows,
} from '../lib/chat-stack-follow'
import type { AgentLiveSnapshot } from './useAgentPresence'
import { useAgents } from './useAgents'
import { usePinnedIds } from './usePinnedIds'

const AGENT_TABLE = 'agent_live'
const REFETCH_DEBOUNCE_MS = 600
const PRUNE_EVERY_MS = 60 * 1000

export type StackCard = StackCardState & {
  /** Agents drawn on the card's top edge, live state merged in. */
  faces: ChatStackAgent[]
}

function threadIdOf(event: GatewayEvent): string | null {
  const data = (event.data ?? {}) as Record<string, unknown>
  const thread = data.thread as Record<string, unknown> | undefined
  const raw = thread?.id ?? data.signal_id ?? data.thread_id
  return typeof raw === 'string' && raw ? raw : null
}

function workingAgentsFor(threadId: string): [string, AgentLiveSnapshot][] {
  return listLiveEntries<AgentLiveSnapshot>(AGENT_TABLE).filter(
    ([, snap]) => snap.status === 'working' && snap.threadId === threadId,
  )
}

/**
 * The chat stack: pinned conversations plus the ones that follow you after
 * you leave them. Cards come from `/signals/stack`; live agent state and
 * thread events keep them moving between fetches.
 */
export function useChatStack() {
  const { token, user } = useAuth()
  const location = useLocation()
  const scope = user ? `${user.uuid ?? user.id}:${user.organisationId ?? user.tenant?.slug ?? ''}` : null
  const follows = useFollows(scope)
  const { pinnedIds } = usePinnedIds()
  const { agents } = useAgents()
  const agentVersion = useLiveVersion(AGENT_TABLE)
  const activeCall = useAgentCallLive()
  const [items, setItems] = useState<ChatStackItem[]>([])
  const [rawSeats, setRawSeats] = useState<DockSeat[]>([])
  const [allCallKey, setAllCallKey] = useState('F12')
  const [loaded, setLoaded] = useState(false)
  const followIds = useMemo(() => follows.map((f) => f.id), [follows])
  const followKey = followIds.join(',')
  const pinKey = pinnedIds.join(',')
  const lastEventAt = useRef(new Map<string, number>())
  const itemIdsRef = useRef(new Set<string>())
  const orderHold = useRef<string[] | null>(null)
  const callBusy =
    activeCall?.status === 'live' || activeCall?.status === 'connecting' || activeCall?.status === 'ringing'
  if (!callBusy) orderHold.current = null

  const fetchSeq = useRef(0)
  const refetch = useCallback(async () => {
    if (!token) return
    const seq = ++fetchSeq.current
    try {
      const next = await fetchChatStack(token, followKey ? followKey.split(',') : [])
      if (seq !== fetchSeq.current) return
      setItems(next.items)
      setRawSeats(next.seats)
      setAllCallKey(next.allCallKey)
      setLoaded(true)
    } catch {
      // The stack is a convenience surface; keep the last cards.
    }
  }, [token, followKey])

  const timer = useRef<number | null>(null)
  const scheduleRefetch = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      timer.current = null
      void refetch()
    }, REFETCH_DEBOUNCE_MS)
  }, [refetch])

  useEffect(() => {
    if (!token) {
      setItems([])
      setRawSeats([])
      return
    }
    void refetch()
  }, [token, refetch, pinKey])

  useEffect(() => onLiveReconnect(() => void refetch()), [refetch])

  useEffect(() => {
    itemIdsRef.current = new Set(items.map((i) => i.id))
    setChatStackIds(itemIdsRef.current)
  }, [items])

  useEffect(() => () => setChatStackIds([]), [])

  // Thread events: remember activity (for the follow-on-leave rule), keep
  // followed threads alive, and nudge + refresh cards already in the stack.
  useEffect(() => {
    if (!token) return
    return onGatewayEvent('threads', (event) => {
      const id = threadIdOf(event)
      if (!id) return
      lastEventAt.current.set(id, Date.now())
      updateFollows(scope, (prev) => touchFollow(prev, id, Date.now()))
      if (!itemIdsRef.current.has(id)) return
      if (event.event === 'message') nudgeChatStack(id)
      scheduleRefetch()
    })
  }, [token, scope, scheduleRefetch])

  // Notes arriving, played or pins changing move seats in the dock.
  useEffect(() => {
    if (!token) return
    const offNotes = onGatewayEvent('notifications', (event) => {
      if (event.event === 'intercom.note' || event.event === 'intercom.played') scheduleRefetch()
    })
    const onDock = () => scheduleRefetch()
    window.addEventListener(DOCK_CHANGED_EVENT, onDock)
    return () => {
      offNotes()
      window.removeEventListener(DOCK_CHANGED_EVENT, onDock)
    }
  }, [token, scheduleRefetch])

  // An agent starting or finishing in a stacked thread changes the card.
  const prevWorking = useRef(new Set<string>())
  useEffect(() => {
    const now = new Set<string>()
    for (const [, snap] of listLiveEntries<AgentLiveSnapshot>(AGENT_TABLE)) {
      if (snap.status === 'working' && snap.threadId) now.add(snap.threadId)
    }
    const changed = [...now, ...prevWorking.current].some(
      (id) => now.has(id) !== prevWorking.current.has(id) && itemIdsRef.current.has(id),
    )
    for (const id of now) updateFollows(scope, (prev) => touchFollow(prev, id, Date.now()))
    prevWorking.current = now
    if (changed) scheduleRefetch()
  }, [agentVersion, scope, scheduleRefetch])

  // Leaving a conversation: follow it when something is still going on.
  const openThreadId = threadIdFromPath(location.pathname)
  const prevOpen = useRef<string | null>(openThreadId)
  useEffect(() => {
    const left = prevOpen.current
    prevOpen.current = openThreadId
    if (!left || left === openThreadId) return
    if (pinnedIds.includes(left)) return
    const now = Date.now()
    const follow = shouldFollowOnLeave({
      agentWorking: workingAgentsFor(left).length > 0,
      hasDraft: hasStoredComposerDraft(left),
      lastActivityAt: lastEventAt.current.get(left) ?? null,
      now,
    })
    if (follow) updateFollows(scope, (prev) => addFollow(prev, left, now))
  }, [openThreadId, pinnedIds, scope])

  useEffect(() => {
    if (!scope) return
    const id = window.setInterval(() => {
      updateFollows(scope, (prev) => {
        const next = pruneFollows(prev, Date.now())
        return next.length === prev.length ? prev : next
      })
    }, PRUNE_EVERY_MS)
    return () => window.clearInterval(id)
  }, [scope])

  const unfollow = useCallback(
    (threadId: string) => updateFollows(scope, (prev) => removeFollow(prev, threadId)),
    [scope],
  )

  const follow = useCallback(
    (threadId: string) => updateFollows(scope, (prev) => addFollow(prev, threadId, Date.now())),
    [scope],
  )

  const cards = useMemo<StackCard[]>(() => {
    const byAgentId = new Map(agents.map((a) => [a.id, a]))
    const merged = items.map((item) => {
      const liveRows = workingAgentsFor(item.id)
      const liveIds = new Set(liveRows.map(([id]) => id))
      const faces: ChatStackAgent[] = []
      for (const [agentId, snap] of liveRows) {
        const known = item.agents.find((a) => a.id === agentId)
        const runtime = byAgentId.get(agentId)
        if (!known && !runtime) continue
        faces.push({
          id: agentId,
          name: known?.name ?? runtime?.name ?? '',
          kind: known?.kind ?? runtime?.kind ?? null,
          avatarKind: known?.avatarKind ?? runtime?.avatar_kind ?? null,
          avatarIcon: known?.avatarIcon ?? runtime?.avatar_icon ?? null,
          avatarColor: known?.avatarColor ?? runtime?.avatar_color ?? null,
          avatarShape: known?.avatarShape ?? runtime?.avatar_shape ?? null,
          avatarImageUrl: known?.avatarImageUrl ?? runtime?.avatar_image_url ?? null,
          working: true,
          summary: snap.summary ?? known?.summary ?? null,
        })
      }
      for (const agent of item.agents) {
        if (liveIds.has(agent.id)) continue
        const snap = listLiveEntries<AgentLiveSnapshot>(AGENT_TABLE).find(([id]) => id === agent.id)?.[1]
        // A websocket snapshot outranks the REST flag once it exists.
        const working = snap ? snap.status === 'working' && snap.threadId === item.id : agent.working
        faces.push({ ...agent, working })
      }
      const front = faces.find((f) => f.working) ?? null
      const shown = front ?? faces[0] ?? null
      const callPhase =
        activeCall && activeCall.signalId === item.id ? activeCall.status : null
      return {
        ...item,
        faces: shown ? [shown] : [],
        live: Boolean(front) || callPhase === 'live' || callPhase === 'connecting',
        liveSummary:
          callPhase === 'ringing' || callPhase === 'live' || callPhase === 'connecting'
            ? null
            : (front?.summary ?? null),
        liveAgentName: activeCall?.signalId === item.id ? activeCall.agentName : (front?.name ?? null),
        callPhase,
      }
    })
    const ordered = orderStackCards(merged)
    if (!callBusy || !orderHold.current?.length) return ordered
    return stabilizeStackOrder(ordered, orderHold.current)
    // agentVersion re-reads the live agent table.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, agents, agentVersion, activeCall, callBusy])

  // Hide the open full-screen thread, unless an in-app call is on it —
  // then the stack card stays as the live call mark.
  const visibleCards = useMemo(
    () => cards.filter((card) => card.id !== openThreadId || Boolean(card.callPhase)),
    [cards, openThreadId],
  )
  if (callBusy && !orderHold.current?.length && visibleCards.length) {
    orderHold.current = visibleCards.map((card) => card.id)
  }

  // Dock seats with the websocket's working flag over the REST one.
  const seats = useMemo<DockSeat[]>(() => {
    const live = new Map(listLiveEntries<AgentLiveSnapshot>(AGENT_TABLE))
    return rawSeats.map((seat) => {
      const snap = live.get(seat.id)
      if (!snap) return seat
      const working = snap.status === 'working'
      const state = seat.state === 'idle' && working ? 'thinking' : seat.state === 'thinking' && !working ? 'idle' : seat.state
      return { ...seat, working, state, summary: working ? (snap.summary ?? seat.summary) : null }
    })
    // agentVersion re-reads the live agent table.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawSeats, agentVersion])

  return { cards: visibleCards, seats, allCallKey, loaded, refetch, follow, unfollow, openThreadId }
}
