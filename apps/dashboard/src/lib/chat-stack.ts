import { useSyncExternalStore } from 'react'
import { appRoutes } from '../api/routes/app.routes'
import { apiGet } from './api'
import { playEarcon } from './earcons'

/* Shell-wide stack state: which conversations sit in the stack (toasts for
 * them become a card nudge) and which one is open in the floating window. */

type Listener = () => void

let stackIds = new Set<string>()
const nudgeListeners = new Set<(threadId: string) => void>()
const floatingListeners = new Set<Listener>()

export type FloatingState = { threadId: string; origin: DOMRect | null } | null
let floating: FloatingState = null

export function setChatStackIds(ids: Iterable<string>) {
  stackIds = new Set([...ids].map(String))
}

export function isInChatStack(threadId: string | null | undefined): boolean {
  return Boolean(threadId && stackIds.has(String(threadId)))
}

export function nudgeChatStack(threadId: string) {
  for (const listener of [...nudgeListeners]) listener(String(threadId))
}

export function onChatStackNudge(listener: (threadId: string) => void): () => void {
  nudgeListeners.add(listener)
  return () => {
    nudgeListeners.delete(listener)
  }
}

export function openFloatingThread(threadId: string, origin: DOMRect | null = null) {
  const id = String(threadId)
  // One floating window: opening the same conversation again does nothing.
  if (floating?.threadId === id) return
  floating = { threadId: id, origin }
  for (const listener of [...floatingListeners]) listener()
  playEarcon('panelOpen')
}

export function floatingThreadId(): string | null {
  return floating?.threadId ?? null
}

export function closeFloatingThread(opts?: { sound?: boolean }) {
  if (!floating) return
  floating = null
  for (const listener of [...floatingListeners]) listener()
  if (opts?.sound !== false) playEarcon('panelClose')
}

export type FloatingCloseKind = 'minimize' | 'hide'

const closeRequestListeners = new Set<(kind: FloatingCloseKind) => void>()

/** Ask the open window to shrink into its card before it unmounts. */
export function requestFloatingThreadClose(kind: FloatingCloseKind = 'hide') {
  if (!floating) return
  if (closeRequestListeners.size === 0) {
    closeFloatingThread()
    return
  }
  for (const listener of [...closeRequestListeners]) listener(kind)
}

export function onFloatingThreadCloseRequest(listener: (kind: FloatingCloseKind) => void): () => void {
  closeRequestListeners.add(listener)
  return () => {
    closeRequestListeners.delete(listener)
  }
}

function subscribeFloating(listener: Listener) {
  floatingListeners.add(listener)
  return () => {
    floatingListeners.delete(listener)
  }
}

export function useFloatingThread(): FloatingState {
  return useSyncExternalStore(subscribeFloating, () => floating, () => null)
}

/** A thread header asks the shell to minimize the open conversation into the stack. */
export const MINIMIZE_EVENT = 'bokito:chat-stack-minimize'

export function requestMinimizeToStack(threadId: string, origin: DOMRect | null, title?: string) {
  window.dispatchEvent(
    new CustomEvent(MINIMIZE_EVENT, { detail: { threadId: String(threadId), origin, title } }),
  )
}

export type ChatStackAgent = {
  id: string
  name: string
  kind: string | null
  avatarKind: string | null
  avatarIcon: string | null
  avatarColor: string | null
  avatarShape: string | null
  avatarImageUrl: string | null
  working: boolean
  summary: string | null
}

export type ChatStackItem = {
  id: string
  title: string
  preview: string
  previewAuthor: string | null
  previewBy: 'agent' | 'contact' | 'team'
  unread: boolean
  status: string
  channel: string
  pinned: boolean
  lastActivityAt: string | null
  agents: ChatStackAgent[]
}

type RawAgent = {
  id: string
  name: string
  kind?: string | null
  avatar_kind?: string | null
  avatar_icon?: string | null
  avatar_color?: string | null
  avatar_shape?: string | null
  avatar_image_url?: string | null
  working?: boolean
  summary?: string | null
}

type RawItem = {
  id: string
  title: string
  preview: string
  preview_author?: string | null
  preview_by: ChatStackItem['previewBy']
  unread: boolean
  status: string
  channel: string
  pinned: boolean
  last_activity_at?: string | null
  agents?: RawAgent[]
}

function normalizeAgent(raw: RawAgent): ChatStackAgent {
  return {
    id: raw.id,
    name: raw.name,
    kind: raw.kind ?? null,
    avatarKind: raw.avatar_kind ?? null,
    avatarIcon: raw.avatar_icon ?? null,
    avatarColor: raw.avatar_color ?? null,
    avatarShape: raw.avatar_shape ?? null,
    avatarImageUrl: raw.avatar_image_url ?? null,
    working: Boolean(raw.working),
    summary: raw.summary ?? null,
  }
}

export function normalizeStackItem(raw: RawItem): ChatStackItem {
  return {
    id: String(raw.id),
    title: raw.title || '',
    preview: raw.preview || '',
    previewAuthor: raw.preview_author ?? null,
    previewBy: raw.preview_by,
    unread: Boolean(raw.unread),
    status: raw.status,
    channel: raw.channel,
    pinned: Boolean(raw.pinned),
    lastActivityAt: raw.last_activity_at ?? null,
    agents: (raw.agents ?? []).map(normalizeAgent),
  }
}

export type SeatState = 'idle' | 'thinking' | 'has_note' | 'live'

/** One face in the dock. The server decides order, key and state. */
export type DockSeat = ChatStackAgent & {
  /** Where a hold on this face lands first: its card, else its intercom lane. */
  threadId: string | null
  laneId: string | null
  onCardId: string | null
  pinned: boolean
  /** Not pinned; here until its note is heard. */
  temporary: boolean
  state: SeatState
  unplayed: number
  dialKey: string | null
  viaAgentId: string | null
}

type RawSeat = RawAgent & {
  agent_id?: string
  thread_id?: string | null
  lane_id?: string | null
  on_card_id?: string | null
  pinned?: boolean
  temporary?: boolean
  state?: SeatState
  unplayed?: number
  dial_key?: string | null
  via_agent_id?: string | null
}

function normalizeSeat(raw: RawSeat): DockSeat {
  return {
    ...normalizeAgent({ ...raw, id: raw.agent_id || raw.id }),
    threadId: raw.thread_id ?? null,
    laneId: raw.lane_id ?? null,
    onCardId: raw.on_card_id ?? null,
    pinned: Boolean(raw.pinned),
    temporary: Boolean(raw.temporary),
    state: raw.state ?? 'idle',
    unplayed: raw.unplayed ?? 0,
    dialKey: raw.dial_key ?? null,
    viaAgentId: raw.via_agent_id ?? null,
  }
}

export type ChatStackPayload = { items: ChatStackItem[]; seats: DockSeat[]; allCallKey: string }

export async function fetchChatStack(token: string, followIds: string[]): Promise<ChatStackPayload> {
  const params = new URLSearchParams()
  if (followIds.length) params.set('follow', followIds.join(','))
  const payload = await apiGet<{ items?: RawItem[]; agents?: RawSeat[]; all_call_key?: string }>(
    appRoutes.signals.stack(params),
    token,
  )
  const seen = new Set<string>()
  const items: ChatStackItem[] = []
  for (const raw of payload.items ?? []) {
    const item = normalizeStackItem(raw)
    if (seen.has(item.id)) continue
    seen.add(item.id)
    items.push(item)
  }
  return {
    items,
    seats: (payload.agents ?? []).map(normalizeSeat),
    allCallKey: payload.all_call_key || 'F12',
  }
}

/** Dial keys as the server names them ("F2", "Shift+F2") matched against a key event. */
export function matchesDialKey(event: KeyboardEvent, dialKey: string | null): boolean {
  if (!dialKey || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return false
  const shift = dialKey.startsWith('Shift+')
  const key = shift ? dialKey.slice(6) : dialKey
  return event.key === key && event.shiftKey === shift
}

/** Key-up ends a hold whatever the modifier state is by then. */
export function releasesDialKey(event: KeyboardEvent, dialKey: string | null): boolean {
  if (!dialKey) return false
  return event.key === (dialKey.startsWith('Shift+') ? dialKey.slice(6) : dialKey)
}

export function dialKeyLabel(dialKey: string | null): string {
  if (!dialKey) return ''
  return dialKey.startsWith('Shift+') ? `⇧${dialKey.slice(6)}` : dialKey
}

/** Live-merged card state the stack draws from. */
export type StackCardState = ChatStackItem & {
  /** An agent is working in this conversation right now. */
  live: boolean
  /** The live agent's current step, when known. */
  liveSummary: string | null
  liveAgentName: string | null
  /** In-app agent call on this conversation (feature-flagged). */
  callPhase: 'ringing' | 'connecting' | 'live' | null
}

function activityMs(item: ChatStackItem): number {
  const ms = item.lastActivityAt ? Date.parse(item.lastActivityAt) : NaN
  return Number.isFinite(ms) ? ms : 0
}

function callRank(card: StackCardState): number {
  if (card.callPhase === 'ringing') return 3
  if (card.callPhase === 'connecting' || card.callPhase === 'live') return 2
  return 0
}

/**
 * Front of the stack first: incoming call, live call, unread, recent.
 * Working agents no longer reshuffle the dock — that thrashed transforms and
 * left stacked ghost copies of the same card while an agent streamed.
 */
export function orderStackCards<T extends StackCardState>(cards: T[]): T[] {
  return [...cards].sort((a, b) => {
    const callDiff = callRank(b) - callRank(a)
    if (callDiff) return callDiff
    if (a.unread !== b.unread) return a.unread ? -1 : 1
    return activityMs(b) - activityMs(a)
  })
}

/**
 * While a call is up, keep every other card where it already was.
 * A refetch that only bumps activity used to swap those cards, and the
 * transform transition drew them as copies sliding back and forth.
 * The call itself still comes to the front.
 */
export function stabilizeStackOrder<T extends StackCardState>(cards: T[], previousIds: readonly string[]): T[] {
  const rank = new Map(previousIds.map((id, index) => [id, index]))
  return [...cards].sort((a, b) => {
    const callDiff = callRank(b) - callRank(a)
    if (callDiff) return callDiff
    const ai = rank.get(a.id)
    const bi = rank.get(b.id)
    if (ai == null && bi == null) return 0
    if (ai == null) return 1
    if (bi == null) return -1
    return ai - bi
  })
}
