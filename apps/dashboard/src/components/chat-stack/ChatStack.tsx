import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { MessagesSquare } from 'lucide-react'
import { callRoutes } from '../../api/routes/calls.routes'
import { useAuth } from '../../context/AuthContext'
import { useChatStack, type StackCard } from '../../hooks/useChatStack'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { setThreadPinned } from '../../hooks/usePinnedIds'
import {
  MINIMIZE_EVENT,
  closeFloatingThread,
  onChatStackNudge,
  openFloatingThread,
  useFloatingThread,
} from '../../lib/chat-stack'
import { apiPost } from '../../lib/api'
import {
  agentCallLive,
  callTabId,
  requestAgentCallHold,
  requestAgentVoiceStart,
  useAgentCallLive,
  type AgentVoiceOffer,
} from '../../lib/agent-call-live'
import { inboxPath } from '../../lib/messages-paths'
import { openEntityPath } from '../../lib/open-entity'
import {
  assistantLauncherRect,
  launcherHiddenFor,
  onAssistantOpen,
  setLauncherSuppressed,
} from '../../lib/personal-assistant-widget'
import { AiAvatar } from '../ui/AiAvatar'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog'
import { ChatStackCard, DIAL_KEYS, dialKeyIndex, StackFaces } from './ChatStackCard'
import { FloatingThreadWindow } from './FloatingThreadWindow'

const CARD_WIDTH = 248
const CARD_HEIGHT = 62
/** One face when idle — peeking layers looked like duplicate copies of the front chat. */
const COLLAPSED_VISIBLE = 1
const MAX_FAN = 6
const EDGE = 16
const MAX_STACK_FACES = 6
const NUDGE_MS = 700
const LEAVE_DELAY_MS = 180

function useStackAnchor(pathname: string, floatingOpen: boolean) {
  const [anchor, setAnchor] = useState({ right: EDGE, bottom: EDGE })
  useEffect(() => {
    const measure = () => {
      let bottom = EDGE
      // Rise only when the page composer actually sits under the stack corner.
      // On Communication the Send button lives in the centre column, so the
      // stack can stay at the bottom edge without covering it.
      const send = [...document.querySelectorAll<HTMLElement>('[data-testid="composer-send"]')].find(
        (el) => !el.closest('[data-floating-thread]') && el.offsetParent !== null,
      )
      if (send) {
        const rect = send.getBoundingClientRect()
        const stackLeft = window.innerWidth - EDGE - CARD_WIDTH
        const overlapsCorner =
          rect.right > stackLeft && rect.bottom > window.innerHeight - EDGE - CARD_HEIGHT
        if (overlapsCorner) {
          bottom = Math.max(EDGE, window.innerHeight - rect.top + 12)
        }
      }
      // Step aside only when the helper launcher actually sits in our corner.
      const launcher = floatingOpen || launcherHiddenFor(pathname) ? null : assistantLauncherRect()
      const clashes =
        launcher != null &&
        launcher.right > window.innerWidth - EDGE - CARD_WIDTH &&
        launcher.bottom > window.innerHeight - bottom - CARD_HEIGHT - 24
      const right = clashes ? Math.max(EDGE, window.innerWidth - launcher.left + 12) : EDGE
      setAnchor((prev) => (prev.right === right && prev.bottom === bottom ? prev : { right, bottom }))
    }
    measure()
    const id = window.setInterval(measure, 500)
    window.addEventListener('resize', measure)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('resize', measure)
    }
  }, [pathname, floatingOpen])
  return anchor
}

/** A title card that flies from the thread header into the stack. */
function flyToStack(origin: DOMRect, target: { right: number; bottom: number }, title: string) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const ghost = document.createElement('div')
  ghost.className =
    'pointer-events-none fixed z-[70] truncate rounded-lg border border-border bg-bg-elevated px-3 py-2 text-sm font-medium text-text-heading shadow-overlay'
  ghost.textContent = title
  const startW = Math.min(origin.width, 520)
  Object.assign(ghost.style, {
    left: `${origin.left}px`,
    top: `${origin.top}px`,
    width: `${startW}px`,
    transformOrigin: 'top left',
  })
  document.body.appendChild(ghost)
  const drop = () => {
    ghost.remove()
  }
  const endLeft = window.innerWidth - target.right - CARD_WIDTH
  const endTop = window.innerHeight - target.bottom - CARD_HEIGHT
  const dx = endLeft - origin.left
  const dy = endTop - origin.top
  const scale = CARD_WIDTH / startW
  try {
    const anim = ghost.animate(
      [
        { transform: 'translate(0, 0) scale(1)', opacity: 1 },
        { transform: `translate(${dx * 0.55}px, ${dy * 0.35 - 40}px) scale(${(1 + scale) / 2})`, opacity: 1, offset: 0.55 },
        { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0.2 },
      ],
      { duration: 560, easing: 'cubic-bezier(0.45, 0, 0.2, 1)' },
    )
    anim.onfinish = drop
    anim.oncancel = drop
    window.setTimeout(drop, 800)
  } catch {
    drop()
  }
}

/**
 * Chats at hand, bottom-right on every page: pinned conversations plus the
 * ones that follow you after you leave them. Hover fans the stack out to the
 * left; a card opens the conversation in a floating window.
 */
export default function ChatStack() {
  const { t } = useTranslation('communication')
  const { token, user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const isMdUp = useMediaQuery('(min-width: 768px)')
  const { cards, follow, unfollow } = useChatStack()
  const liveCall = useAgentCallLive()
  const callingAgentId =
    liveCall && (liveCall.status === 'live' || liveCall.status === 'connecting') ? liveCall.agentId : ''
  const callingRef = useRef(callingAgentId)
  callingRef.current = callingAgentId
  const floating = useFloatingThread()
  const anchor = useStackAnchor(location.pathname, Boolean(floating))
  const [expanded, setExpanded] = useState(false)
  const [nudged, setNudged] = useState<Record<string, number>>({})
  const [sheetOpen, setSheetOpen] = useState(false)
  const leaveTimer = useRef<number | null>(null)
  const cardsRef = useRef(cards)
  cardsRef.current = cards

  const fanCount = useMemo(() => {
    if (typeof window === 'undefined') return MAX_FAN
    const room = Math.floor((window.innerWidth - anchor.right - 24) / (CARD_WIDTH + 10))
    return Math.max(1, Math.min(MAX_FAN, room))
  }, [anchor.right])
  const visible = expanded ? fanCount : COLLAPSED_VISIBLE
  const overflow = Math.max(0, cards.length - visible)

  // Collapsed: every agent in the stack stands side by side in front of the cards.
  const stackFaces = useMemo(() => {
    const seen = new Map<string, StackCard['faces'][number]>()
    for (const card of cards) {
      for (const face of card.faces) {
        const prev = seen.get(face.id)
        if (!prev || (face.working && !prev.working)) seen.set(face.id, face)
      }
    }
    return [...seen.entries()]
      .sort((a, b) => Number(b[1].working) - Number(a[1].working))
      .slice(0, MAX_STACK_FACES)
      .map(([id, face]) => {
        const card = cards.find((row) => row.faces.some((agent) => agent.id === id))
        return { ...face, threadId: card?.id }
      })
  }, [cards])
  const dockFaces = useMemo(() => {
    if (!callingAgentId) return stackFaces
    const mine = stackFaces.filter((face) => face.id === callingAgentId)
    return mine.length ? mine : stackFaces
  }, [stackFaces, callingAgentId])
  const dialLabels = useMemo(() => {
    const labels: Record<string, string> = {}
    dockFaces.forEach((face, index) => {
      const label = DIAL_KEYS[index]?.label
      if (label) labels[face.id] = label
    })
    return labels
  }, [dockFaces])

  // Close the floating window when its conversation opens full-screen.
  useEffect(() => {
    if (!floating) return
    if (location.pathname.includes(`/t/${encodeURIComponent(floating.threadId)}`)) closeFloatingThread()
  }, [location.pathname, floating])

  useEffect(
    () =>
      onChatStackNudge((threadId) => {
        setNudged((prev) => ({ ...prev, [threadId]: Date.now() }))
        window.setTimeout(() => {
          setNudged((prev) => {
            if (!(threadId in prev)) return prev
            const next = { ...prev }
            delete next[threadId]
            return next
          })
        }, NUDGE_MS)
      }),
    [],
  )

  const open = useCallback((card: StackCard, el: HTMLElement | null) => {
    setExpanded(false)
    setSheetOpen(false)
    openFloatingThread(card.id, el ? el.getBoundingClientRect() : null)
  }, [])

  const dialing = useRef(false)
  const talkThread = useRef<string | null>(null)
  const [holding, setHolding] = useState<string | null>(null)
  const beginTalk = useCallback(
    (threadId: string) => {
      const live = agentCallLive()
      if (live && live.signalId !== threadId) {
        toast.error(t('agentCall.voiceModeBusy'))
        return
      }
      talkThread.current = threadId
      setHolding(threadId)
      requestAgentCallHold(true)
      if (live || dialing.current) return
      dialing.current = true
      void apiPost<AgentVoiceOffer>(callRoutes.voice, {
        signal_id: threadId,
        client_id: callTabId(),
        push_to_talk: true,
      })
        .then((session) => requestAgentVoiceStart({ ...session, pushToTalk: true }))
        .catch((err: unknown) => {
          toast.error(err instanceof Error ? err.message : t('agentCall.voiceFailed'))
          if (talkThread.current === threadId) {
            talkThread.current = null
            setHolding(null)
            requestAgentCallHold(false)
          }
        })
        .finally(() => {
          dialing.current = false
        })
    },
    [t],
  )
  const endTalk = useCallback(() => {
    if (!talkThread.current) return
    talkThread.current = null
    setHolding(null)
    requestAgentCallHold(false)
  }, [])

  useEffect(() => {
    if (!user?.agentCallsEnabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      const index = dialKeyIndex(event)
      const face = index >= 0 ? dockFaces[index] : undefined
      if (!face?.threadId) return
      const el = event.target
      if (el instanceof HTMLElement && el.closest('input, textarea, [contenteditable="true"]')) return
      event.preventDefault()
      beginTalk(face.threadId)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (!talkThread.current) return
      if (event.key !== 'F1' && event.key !== 'F2' && event.key !== 'F4' && event.key !== 'F8' && event.key !== 'F9') {
        return
      }
      endTalk()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', endTalk)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', endTalk)
    }
  }, [user?.agentCallsEnabled, dockFaces, beginTalk, endTalk])

  const togglePin = useCallback(
    async (card: StackCard, opts: { keepFollowing?: boolean } = {}) => {
      if (!token) return
      const next = !card.pinned
      if (!next && opts.keepFollowing) follow(card.id)
      if (next) unfollow(card.id)
      try {
        await setThreadPinned(token, card.id, next)
      } catch {
        toast.error(t('chatStack.pinError'))
      }
    },
    [token, follow, unfollow, t],
  )

  // Thread header "Minimize": pin, fly the title into the stack, back to the list.
  useEffect(() => {
    const onMinimize = (event: Event) => {
      const detail = (event as CustomEvent<{ threadId: string; origin: DOMRect | null; title?: string }>).detail
      if (!detail?.threadId || !token) return
      const { threadId, origin } = detail
      void setThreadPinned(token, threadId, true).catch(() => toast.error(t('chatStack.pinError')))
      unfollow(threadId)
      if (origin) flyToStack(origin, anchor, detail.title || t('chatStack.untitled'))
      const path = location.pathname
      const idx = path.indexOf('/t/')
      navigate(`${idx >= 0 ? path.slice(0, idx) : path}${location.search}`)
    }
    window.addEventListener(MINIMIZE_EVENT, onMinimize)
    return () => window.removeEventListener(MINIMIZE_EVENT, onMinimize)
  }, [token, anchor, location.pathname, location.search, navigate, unfollow, t])

  // Alt+1..9 opens the nth card, Alt+0 fans the stack out or back.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      const match = /^Digit(\d)$/.exec(event.code)
      if (!match) return
      const n = Number(match[1])
      if (n === 0) {
        if (!cardsRef.current.length || callingRef.current) return
        event.preventDefault()
        setExpanded((prev) => !prev)
        return
      }
      const card = cardsRef.current[n - 1]
      if (!card) return
      event.preventDefault()
      const el = document.querySelector<HTMLElement>(
        `[data-stack-card-id="${CSS.escape(card.id)}"] .chat-stack-card-body`,
      )
      open(card, el)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  useEffect(() => {
    if (callingAgentId) setExpanded(false)
  }, [callingAgentId])

  const enter = () => {
    if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current)
    leaveTimer.current = null
    // A live line keeps one card. Fanning unmounts the face under the pointer,
    // the hover drops, and the other cards slide out and back.
    if (callingAgentId) return
    setExpanded(true)
  }
  const leave = () => {
    if (leaveTimer.current !== null) window.clearTimeout(leaveTimer.current)
    leaveTimer.current = window.setTimeout(() => {
      leaveTimer.current = null
      setExpanded(false)
    }, LEAVE_DELAY_MS)
  }

  const floatingCard = floating ? cards.find((c) => c.id === floating.threadId) ?? null : null

  // The floating thread takes the helper launcher's corner while it is open.
  const floatingOpen = Boolean(floating)
  useEffect(() => {
    if (!floatingOpen) return
    setLauncherSuppressed(true)
    return () => setLauncherSuppressed(false)
  }, [floatingOpen])

  const onFloatingMinimize = useCallback(() => {
    const id = floating?.threadId
    closeFloatingThread()
    if (!id) return
    // A followed chat that is done and now read has served its purpose.
    const card = cardsRef.current.find((c) => c.id === id)
    if (card && !card.pinned && !card.live) window.setTimeout(() => unfollow(id), 1200)
  }, [floating, unfollow])

  // Opening the helper (Help, a Bokito thread) hands the corner back.
  const minimizeRef = useRef(onFloatingMinimize)
  minimizeRef.current = onFloatingMinimize
  useEffect(() => onAssistantOpen(() => minimizeRef.current()), [])

  if (!token) return null
  if (!cards.length && !floating) return null

  const morePath = `${inboxPath('all')}?filter=pinned`

  if (!isMdUp) {
    const front = cards[0]
    const face = front?.faces.find((f) => f.working) ?? front?.faces[0] ?? null
    return (
      <>
        {cards.length ? (
          <div className="fixed z-40" style={{ right: anchor.right, bottom: anchor.bottom }}>
            <Button
              type="button"
              variant="secondary"
              className="relative h-12 w-12 rounded-full p-0 shadow-overlay"
              aria-label={t('chatStack.label')}
              onClick={() => setSheetOpen(true)}
            >
              {face ? (
                <AiAvatar
                  size={32}
                  name={face.name}
                  kind={face.avatarKind ?? face.kind}
                  icon={face.avatarIcon}
                  color={face.avatarColor}
                  shape={face.avatarShape}
                  imageUrl={face.avatarImageUrl}
                  mode={face.working ? 'live' : 'static'}
                  motion={face.working ? 'working' : null}
                  decorative
                />
              ) : (
                <MessagesSquare size={20} aria-hidden />
              )}
              <span className="absolute -right-1 -top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-2xs font-semibold tabular-nums text-accent-fg">
                {cards.length}
              </span>
            </Button>
          </div>
        ) : null}
        <Dialog open={sheetOpen} onOpenChange={setSheetOpen}>
          <DialogContent className="bottom-0 top-auto max-w-none translate-y-0 gap-2 rounded-t-xl p-4 data-[state=open]:animate-fade-in">
            <DialogTitle className="text-sm">{t('chatStack.label')}</DialogTitle>
            <div className="flex flex-col gap-3 pt-3">
              {cards.map((card) => (
                <div
                  key={card.id}
                  role="button"
                  tabIndex={0}
                  className="cursor-pointer"
                  onClick={() => {
                    setSheetOpen(false)
                    navigate(openEntityPath({ type: 'signal', id: card.id }))
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    setSheetOpen(false)
                    navigate(openEntityPath({ type: 'signal', id: card.id }))
                  }}
                >
                  <ChatStackCard
                    card={card}
                    index={0}
                    expanded={false}
                    hidden={false}
                    width={0}
                    nudge={card.id in nudged}
                    onOpen={() => {}}
                    onTogglePin={() => {}}
                    onDismiss={() => {}}
                    inline
                  />
                </div>
              ))}
            </div>
          </DialogContent>
        </Dialog>
      </>
    )
  }

  return (
    <>
      {cards.length ? (
        <div
          className="chat-stack fixed z-40"
          data-expanded={expanded || undefined}
          role="region"
          aria-label={t('chatStack.label')}
          style={{
            right: anchor.right,
            bottom: anchor.bottom,
            width: CARD_WIDTH,
            height: CARD_HEIGHT,
            transition: 'bottom 220ms ease, right 220ms ease',
          }}
          onMouseEnter={enter}
          onMouseLeave={leave}
          onFocus={enter}
          onBlur={leave}
        >
          <div
            aria-hidden
            className="absolute right-0"
            style={{
              bottom: 0,
              top: -72,
              width: expanded ? visible * CARD_WIDTH + Math.max(0, visible - 1) * 10 : CARD_WIDTH,
              zIndex: 0,
              pointerEvents: expanded ? 'auto' : 'none',
            }}
          />
          {cards.map((card, index) => (
            <ChatStackCard
              key={card.id}
              card={card}
              index={Math.min(index, visible)}
              expanded={expanded}
              hidden={index >= visible}
              width={CARD_WIDTH}
              nudge={card.id in nudged}
              showFaces={expanded}
              onOpen={open}
              onDial={beginTalk}
              onDialEnd={endTalk}
              dialHeld={holding === card.id}
              dialLabels={dialLabels}
              onlyAgentId={callingAgentId || undefined}
              onTogglePin={(c) => void togglePin(c)}
              onDismiss={(c) => {
                unfollow(c.id)
                if (floating?.threadId === c.id) closeFloatingThread()
              }}
            />
          ))}
          {!expanded && stackFaces.length ? (
            <StackFaces
              agents={dockFaces}
              onDial={beginTalk}
              onDialEnd={endTalk}
              heldThreadId={holding}
              dialLabels={dialLabels}
              onlyAgentId={callingAgentId || undefined}
              className="z-[60]"
            />
          ) : null}
          {overflow > 0 ? (
            <Button
              type="button"
              variant="secondary"
              size="xs"
              className="absolute bottom-3 min-w-7 rounded-full px-2 tabular-nums shadow-overlay transition-[right] duration-300"
              style={{
                right: expanded ? visible * (CARD_WIDTH + 10) : CARD_WIDTH + 8,
              }}
              aria-label={t('chatStack.moreLabel')}
              title={t('chatStack.moreLabel')}
              onClick={() => navigate(morePath)}
            >
              {t('chatStack.more', { count: overflow })}
            </Button>
          ) : null}
        </div>
      ) : null}
      {floating ? (
        <FloatingThreadWindow
          key={floating.threadId}
          threadId={floating.threadId}
          origin={floating.origin}
          card={floatingCard}
          right={anchor.right}
          bottom={anchor.bottom + CARD_HEIGHT + 32}
          onMinimize={onFloatingMinimize}
          onClose={() => {
            const id = floating.threadId
            closeFloatingThread()
            unfollow(id)
          }}
          onExpand={() => {
            const id = floating.threadId
            closeFloatingThread()
            navigate(openEntityPath({ type: 'signal', id }))
          }}
          onTogglePin={() => {
            if (floatingCard) void togglePin(floatingCard, { keepFollowing: true })
            else if (token) {
              void setThreadPinned(token, floating.threadId, true).catch(() =>
                toast.error(t('chatStack.pinError')),
              )
            }
          }}
        />
      ) : null}
    </>
  )
}