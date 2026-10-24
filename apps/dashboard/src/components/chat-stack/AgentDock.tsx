import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ExternalLink, Keyboard, MessagesSquare, Mic, MoreHorizontal, PhoneOff, Pin, PinOff, Play, Plus } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useSpeechDictation } from '../../hooks/useSpeechDictation'
import {
  requestAgentCallEnd,
  useAgentCallLive,
  useAgentCallSpeaking,
  useAgentCallUserSpeaking,
} from '../../lib/agent-call-live'
import { dialKeyLabel, matchesDialKey, openFloatingThread, releasesDialKey, type DockSeat } from '../../lib/chat-stack'
import {
  correctIntercomRoute,
  openIntercomLane,
  sendIntercom,
  unpinAgent,
  type IntercomResult,
} from '../../lib/dock-agents'
import { playEarcon } from '../../lib/earcons'
import { MIN_TALK_MS, startRecording, type RecorderHandle } from '../../lib/intercom-recorder'
import { openEntityPath } from '../../lib/open-entity'
import { cn } from '../../lib/utils'
import {
  interruptForSpeech,
  playingNoteContext,
  replayLast,
  startVoiceQueue,
  useVoiceQueue,
  voiceQueueState,
  type HoldContext,
} from '../../lib/voice-queue'
import { ConversationPicker } from '../inbox/ConversationPicker'
import { Avatar } from '../ui/avatar'
import { Button } from '../ui/button'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { Pressable } from '../ui/pressable'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { DockPinPicker } from './DockPinPicker'

const FACE = 32
const LANDING_MS = 4000
const HOVER_MENU_MS = 400
const ALL = '__all__'

type Hold = {
  key: string
  seat: DockSeat | null
  recorder: RecorderHandle | null
  context: HoldContext | null
  /** Key or pointer released before the recorder was ready. */
  released: boolean
  startedAt: number
}

type Landing = { key: string; result: IntercomResult; until: number }

/** One balloon above the active face: what you say, where it landed, what the agent says. */
function SeatBalloon({ children, onHold, noteId }: { children: ReactNode; onHold?: (held: boolean) => void; noteId?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-intercom-note={noteId || undefined}
      className="absolute bottom-full right-[-6px] z-[70] mb-3 w-max max-w-[280px] rounded-md border border-border bg-bg px-2 py-1.5 text-xs font-medium leading-snug text-text-heading shadow-overlay animate-fade-in"
      onMouseEnter={() => onHold?.(true)}
      onMouseLeave={() => onHold?.(false)}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  )
}

function BalloonButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <Button
      variant="ghost"
      size="xs"
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
    >
      {children}
    </Button>
  )
}

/** Words revealed with playback progress, last line only. */
function subtitle(text: string, progress: number): string {
  const words = text.split(/\s+/).filter(Boolean)
  const shown = Math.max(1, Math.ceil(words.length * Math.min(1, progress + 0.08)))
  const upto = words.slice(0, shown)
  return upto.slice(-18).join(' ')
}

/**
 * The agent dock: one row, pinned to the front card's top-right corner.
 * The card's agent is the rightmost face; the rest of the row runs left.
 * The all-call mic sits just to the right of that face, off the card title.
 * Hold a face (or its dial key) to talk; click replays; right-click opens the menu.
 */
export function AgentDock({
  seats,
  allCallKey,
  right,
  bottom,
  hidden,
}: {
  seats: DockSeat[]
  allCallKey: string
  right: number
  bottom: number
  hidden?: boolean
}) {
  const { t } = useTranslation('communication')
  const { token, user } = useAuth()
  const navigate = useNavigate()
  const enabled = Boolean(user?.agentCallsEnabled)
  const userId = user ? String(user.uuid ?? user.id) : ''
  const queue = useVoiceQueue()
  const call = useAgentCallLive()
  const callSpeaking = useAgentCallSpeaking()
  const callUserSpeaking = useAgentCallUserSpeaking()
  const liveAgentId =
    call && (call.status === 'live' || call.status === 'connecting') ? call.agentId : ''

  const [holdKey, setHoldKey] = useState<string | null>(null)
  const [level, setLevel] = useState(0)
  const [interim, setInterim] = useState('')
  const [sendingKey, setSendingKey] = useState<string | null>(null)
  const [landing, setLanding] = useState<Landing | null>(null)
  const [landingHeld, setLandingHeld] = useState(false)
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [hoverFor, setHoverFor] = useState<string | null>(null)
  const [picker, setPicker] = useState<{ open: boolean; agentId: string | null }>({ open: false, agentId: null })
  const [moveFor, setMoveFor] = useState<IntercomResult | null>(null)
  const hold = useRef<Hold | null>(null)
  const hoverTimer = useRef<number | null>(null)
  const seatsRef = useRef(seats)
  seatsRef.current = seats

  const dictation = useSpeechDictation({ onFinal: () => {}, onInterim: setInterim, silent: true })
  const dictationRef = useRef(dictation)
  dictationRef.current = dictation

  useEffect(() => {
    if (!enabled || !token || !userId) return
    return startVoiceQueue(token, userId)
  }, [enabled, token, userId])

  useEffect(() => {
    if (!landing || landingHeld) return
    const id = window.setTimeout(() => setLanding(null), Math.max(0, landing.until - Date.now()))
    return () => window.clearTimeout(id)
  }, [landing, landingHeld])

  const begin = useCallback(
    async (key: string) => {
      if (!enabled || hold.current) return
      if (liveAgentId) {
        toast.error(t('agentCall.voiceModeBusy'))
        return
      }
      const seat = key === ALL ? null : (seatsRef.current.find((s) => s.id === key) ?? null)
      const current: Hold = {
        key,
        seat,
        recorder: null,
        context: playingNoteContext(),
        released: false,
        startedAt: performance.now(),
      }
      hold.current = current
      setHoldKey(key)
      setLanding(null)
      setInterim('')
      try {
        const recorder = await startRecording(setLevel)
        current.recorder = recorder
        if (current.released) {
          recorder.cancel()
          return
        }
        playEarcon('talkStart')
        dictationRef.current.start()
      } catch {
        playEarcon('error')
        toast.error(t('dock.micBlocked'))
        hold.current = null
        setHoldKey(null)
      }
    },
    [enabled, liveAgentId, t],
  )

  const end = useCallback(async () => {
    const current = hold.current
    if (!current) return
    current.released = true
    if (!current.recorder) {
      // Released before the mic opened: a click. Playback keeps going.
      hold.current = null
      setHoldKey(null)
      const playing = voiceQueueState().now?.note.agentId
      if (current.seat && playing !== current.seat.id) void replayLast(current.seat.id)
      return
    }
    const recording = await current.recorder.stop()
    dictationRef.current.stop()
    const heldMs = performance.now() - current.startedAt
    hold.current = null
    setHoldKey(null)
    setInterim('')
    const seat = current.seat
    const playingAgent = current.context?.agentId ?? null

    if (!recording) {
      // Silence or a short click: the note keeps playing.
      if (heldMs >= MIN_TALK_MS) return
      if (seat && playingAgent === seat.id) return
      if (seat) {
        const found = await replayLast(seat.id)
        if (!found) toast.message(t('dock.nothingToReplay', { name: seat.name }))
      } else {
        void replayLast(null)
      }
      return
    }
    playEarcon('talkStop')

    const sameAgent = Boolean(seat && playingAgent && seat.id === playingAgent)
    const replyTo = current.context && (sameAgent || !seat) ? current.context : null
    interruptForSpeech()

    if (!token) return
    setSendingKey(current.key)
    try {
      const result = await sendIntercom(token, {
        agentId: seat?.id ?? null,
        audio: recording.blob,
        filename: recording.filename,
        threadId: seat?.onCardId ?? null,
        seatIds: seat ? undefined : seatsRef.current.map((item) => item.id),
        replyToNoteId: replyTo?.replyToNoteId ?? null,
        positionMs: replyTo?.positionMs ?? null,
      })
      const landingKey = result.broadcast ? ALL : (result.agentId ?? current.key)
      setLanding({ key: seatsRef.current.some((s) => s.id === landingKey) ? landingKey : ALL, result, until: Date.now() + LANDING_MS })
    } catch (err) {
      const msg = formatApiErrorMessage(err, t('dock.sendFailed'))
      // Silence or "name an agent" is guidance, not a failed send.
      if (/hoorde niets|did not hear|ik hoorde niets/i.test(msg)) {
        return
      }
      if (/noem een agent|say an agent|pin an agent to your dock/i.test(msg)) {
        toast.message(msg)
        return
      }
      playEarcon('error')
      toast.error(msg)
    } finally {
      setSendingKey(null)
    }
  }, [t, token])

  // Dial keys: hold to talk anywhere in the app.
  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && hold.current) {
        event.preventDefault()
        const current = hold.current
        current.released = true
        current.recorder?.cancel()
        hold.current = null
        setHoldKey(null)
        setLevel(0)
        setInterim('')
        dictationRef.current.stop()
        playEarcon('talkStop')
        return
      }
      if (event.repeat) {
        if (hold.current) event.preventDefault()
        return
      }
      if (matchesDialKey(event, allCallKey)) {
        event.preventDefault()
        void begin(ALL)
        return
      }
      const seat = seatsRef.current.find((s) => matchesDialKey(event, s.dialKey))
      if (!seat) return
      event.preventDefault()
      void begin(seat.id)
    }
    const onKeyUp = (event: KeyboardEvent) => {
      const current = hold.current
      if (!current) return
      const key = current.key === ALL ? allCallKey : current.seat?.dialKey ?? null
      if (!releasesDialKey(event, key)) return
      event.preventDefault()
      void end()
    }
    const onBlur = () => void end()
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [enabled, allCallKey, begin, end])

  const openThread = useCallback((threadId: string | null) => {
    if (threadId) openFloatingThread(threadId, null)
  }, [])

  const openLane = useCallback(
    async (seat: DockSeat) => {
      if (!token) return
      try {
        openThread(seat.laneId ?? (await openIntercomLane(token, seat.id)))
      } catch (err) {
        toast.error(formatApiErrorMessage(err, t('dock.sendFailed')))
      }
    },
    [openThread, t, token],
  )

  const rerouteNew = useCallback(
    async (result: IntercomResult, targetId: string | null) => {
      if (!token || !result.messageId) return
      try {
        const out = await correctIntercomRoute(token, result.messageId, targetId)
        setLanding((prev) =>
          prev && prev.result.messageId === result.messageId
            ? { ...prev, result: { ...prev.result, threadId: out.thread_id, threadTitle: out.thread_title }, until: Date.now() + LANDING_MS }
            : prev,
        )
        toast.success(t('dock.moved', { title: out.thread_title || t('chatStack.untitled') }))
      } catch (err) {
        toast.error(formatApiErrorMessage(err, t('moveConversation.failed')))
      }
    },
    [t, token],
  )

  if (hidden) return null
  if (!seats.length && !enabled) return null

  const cardSeats = seats.filter((s) => s.onCardId)
  const otherSeats = seats.filter((s) => !s.onCardId)
  const now = queue.now
  const playingKey = now ? (now.note.agentId && seats.some((s) => s.id === now.note.agentId) ? now.note.agentId : ALL) : null
  const balloonKey = holdKey ?? sendingKey ?? playingKey ?? landing?.key ?? null

  const balloonFor = (key: string): ReactNode => {
    if (key !== balloonKey) return null
    if (holdKey === key) {
      return <SeatBalloon>{interim || t('dock.listening')}</SeatBalloon>
    }
    if (sendingKey === key) {
      return <SeatBalloon>{t('dock.sending')}</SeatBalloon>
    }
    if (playingKey === key && now) {
      const via = now.note.viaAgentName
      return (
        <SeatBalloon noteId={now.note.noteId}>
          <p className="text-text-secondary">
            {via ? <span className="text-text-muted">{t('dock.via', { name: via })} </span> : null}
            {now.note.kind === 'digest' ? <span className="text-text-muted">{t('dock.digest')} </span> : null}
            {subtitle(now.note.text, now.progress)}
          </p>
          <div className="mt-1 flex items-center gap-1">
            {now.note.signalId ? (
              <BalloonButton onClick={() => openThread(now.note.signalId)}>
                <ExternalLink size={14} aria-hidden />
                {t('dock.openInThread')}
              </BalloonButton>
            ) : null}
          </div>
        </SeatBalloon>
      )
    }
    if (landing && landing.key === key) {
      const result = landing.result
      if (result.broadcast) {
        return (
          <SeatBalloon onHold={setLandingHeld}>
            {t('dock.broadcastLanded', { count: result.results.filter((r) => r.decision !== 'skip').length })}
          </SeatBalloon>
        )
      }
      return (
        <SeatBalloon onHold={setLandingHeld}>
          <Pressable
            className="block max-w-full truncate text-accent hover:underline"
            onClick={() => openThread(result.threadId)}
          >
            {result.threadTitle || t('chatStack.untitled')}
          </Pressable>
          {result.messageId ? (
            <div className="mt-1 flex items-center gap-1">
              <BalloonButton onClick={() => setMoveFor(result)}>{t('dock.move')}</BalloonButton>
              <BalloonButton onClick={() => void rerouteNew(result, null)}>{t('dock.new')}</BalloonButton>
            </div>
          ) : null}
        </SeatBalloon>
      )
    }
    return null
  }

  const allHeld = holdKey === ALL

  const renderSeat = (seat: DockSeat) => {
    const recording = holdKey === seat.id
    const speaking = Boolean(now && now.note.agentId === seat.id && !now.paused)
    const paused = Boolean(now && now.note.agentId === seat.id && now.paused)
    const live = liveAgentId === seat.id
    const dimmed = (holdKey && !recording && !allHeld) || (liveAgentId && !live)
    const label =
      seat.state === 'thinking' && !recording
        ? t('dock.busy')
        : dialKeyLabel(seat.dialKey)
    const motion = live
      ? callSpeaking
        ? 'talking'
        : callUserSpeaking
          ? 'listening'
          : 'idle'
      : speaking
        ? 'talking'
        : recording
          ? 'listening'
          : seat.working
            ? 'working'
            : 'idle'
    return (
      <div
        key={seat.id}
        className={cn(
          'relative flex flex-col items-center transition-opacity duration-200',
          dimmed && (liveAgentId ? 'opacity-40' : 'opacity-60'),
        )}
        onMouseEnter={() => {
          if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current)
          hoverTimer.current = window.setTimeout(() => setHoverFor(seat.id), HOVER_MENU_MS)
        }}
        onMouseLeave={() => {
          if (hoverTimer.current !== null) window.clearTimeout(hoverTimer.current)
          hoverTimer.current = null
          setHoverFor((prev) => (prev === seat.id ? null : prev))
        }}
      >
        {balloonFor(seat.id)}
        {live ? (
          <Button
            variant="destructive"
            size="iconSm"
            className="absolute right-full top-1 z-20 mr-1.5 rounded-full bg-bg-elevated shadow-overlay"
            aria-label={t('agentCall.hangUp')}
            title={t('agentCall.hangUp')}
            onClick={() => requestAgentCallEnd()}
          >
            <PhoneOff size={14} aria-hidden />
          </Button>
        ) : null}
        <DropdownMenu open={menuFor === seat.id} onOpenChange={(open) => setMenuFor(open ? seat.id : null)}>
          <DropdownMenuTrigger asChild>
            <span className="pointer-events-none absolute left-0 top-0 h-8 w-8" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="end" className="min-w-44">
            <DropdownMenuItem className="gap-2" onSelect={() => setPicker({ open: true, agentId: seat.id })}>
              <Keyboard size={14} aria-hidden />
              {seat.pinned ? t('dock.changeKey') : t('dock.pin')}
            </DropdownMenuItem>
            {seat.pinned ? (
              <DropdownMenuItem
                className="gap-2"
                onSelect={() => {
                  if (token) void unpinAgent(token, seat.id).catch((err) => toast.error(formatApiErrorMessage(err, t('dock.pinFailed'))))
                }}
              >
                <PinOff size={14} aria-hidden />
                {t('dock.unpin')}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem className="gap-2" onSelect={() => void openLane(seat)}>
              <MessagesSquare size={14} aria-hidden />
              {t('dock.openLane')}
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2" onSelect={() => {
                const path = openEntityPath({ type: 'agent', id: seat.id })
                if (path) navigate(path)
              }}>
              <ExternalLink size={14} aria-hidden />
              {t('dock.openAgent')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Pressable
          className={cn(
            'relative w-auto rounded-full outline-none transition-transform duration-150 focus-visible:ring-2 focus-visible:ring-border-focus',
            recording && 'motion-safe:scale-[1.08]',
            (paused || allHeld) && 'ring-2 ring-accent/50',
            live && 'ring-2 ring-ai',
            speaking && 'ring-2 ring-accent motion-safe:animate-pulse',
          )}
          style={recording ? { boxShadow: `0 0 0 ${2 + Math.round(level * 6)}px rgb(var(--color-accent) / 0.35)` } : undefined}
          aria-label={enabled ? t('dock.seatLabel', { name: seat.name, key: dialKeyLabel(seat.dialKey) }) : seat.name}
          title={seat.summary ? `${seat.name} · ${seat.summary}` : seat.name}
          onContextMenu={(event) => {
            event.preventDefault()
            setMenuFor(seat.id)
          }}
          onPointerDown={(event) => {
            if (event.button !== 0 || !enabled) return
            event.preventDefault()
            event.currentTarget.setPointerCapture(event.pointerId)
            void begin(seat.id)
          }}
          onPointerUp={(event) => {
            if (event.button !== 0) return
            void end()
          }}
          onPointerCancel={() => void end()}
          onClick={(event) => {
            if (!enabled) {
              event.preventDefault()
              openThread(seat.threadId)
            }
          }}
        >
          <Avatar
            kind="agent"
            agent={{
              name: seat.name,
              avatar_kind: seat.avatarKind ?? seat.kind,
              avatar_icon: seat.avatarIcon,
              avatar_color: seat.avatarColor,
              avatar_shape: seat.avatarShape,
              avatar_image_url: seat.avatarImageUrl,
            }}
            size={FACE}
            mode="live"
            motion={motion}
            decorative
          />
          {recording ? (
            <span className="absolute -left-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-bg bg-status-error" aria-hidden />
          ) : null}
          {seat.unplayed > 0 ? (
            <span className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full rounded-bl-none bg-accent px-1 text-2xs font-semibold tabular-nums text-accent-fg">
              {seat.unplayed}
            </span>
          ) : null}
        </Pressable>
        {hoverFor === seat.id && menuFor !== seat.id && !holdKey ? (
          <Pressable
            className="absolute -right-2 bottom-3 z-30 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-bg-elevated text-text-muted shadow-sm hover:text-text-heading"
            aria-label={t('dock.menu')}
            onClick={() => setMenuFor(seat.id)}
          >
            <MoreHorizontal size={14} aria-hidden />
          </Pressable>
        ) : null}
        <span
        className={cn(
          'chat-stack-dial mt-0.5 inline-flex h-3.5 items-center gap-0.5 text-2xs leading-none',
          seat.state === 'has_note' ? 'font-medium text-accent' : 'text-text-muted',
        )}
        >
          {seat.state === 'has_note' ? <Play size={14} aria-hidden /> : null}
          {label}
        </span>
      </div>
    )
  }

  return (
    <>
      <div
        className="agent-dock fixed z-[70] flex flex-row-reverse items-end gap-2"
        style={{ right, bottom }}
        role="toolbar"
        aria-label={t('dock.label')}
      >
        {cardSeats.map(renderSeat)}
        {cardSeats.length && otherSeats.length ? <span className="mb-5 h-6 w-px bg-border" aria-hidden /> : null}
        {otherSeats.map(renderSeat)}
        {enabled ? (
          <div className="group/plus relative flex flex-col items-center">
            <Pressable
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-border text-text-muted transition-opacity hover:text-text-heading',
                seats.length ? 'opacity-0 focus-visible:opacity-100 group-hover/plus:opacity-100' : 'opacity-100',
              )}
              aria-label={t('dock.pinTitle')}
              title={t('dock.pinTitle')}
              onClick={() => setPicker({ open: true, agentId: null })}
            >
              {seats.length ? <Plus size={14} aria-hidden /> : <Pin size={14} aria-hidden />}
            </Pressable>
            <span className="mt-0.5 h-3.5" />
          </div>
        ) : null}
        {enabled ? (
          <div className={cn('absolute bottom-0 left-[calc(100%+8px)] flex flex-col items-center', liveAgentId && 'opacity-40')}>
            {balloonFor(ALL)}
            <Pressable
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full border bg-bg-elevated shadow-overlay transition-transform',
                allHeld
                  ? 'border-accent text-accent motion-safe:scale-[1.08]'
                  : 'border-border text-text-secondary hover:text-text-heading',
              )}
              style={allHeld ? { boxShadow: `0 0 0 ${2 + Math.round(level * 6)}px rgb(var(--color-accent) / 0.35)` } : undefined}
              aria-label={t('dock.allCall', { key: dialKeyLabel(allCallKey) })}
              title={t('dock.allCall', { key: dialKeyLabel(allCallKey) })}
              onPointerDown={(event) => {
                if (event.button !== 0) return
                event.preventDefault()
                event.currentTarget.setPointerCapture(event.pointerId)
                void begin(ALL)
              }}
              onPointerUp={(event) => {
                if (event.button !== 0) return
                void end()
              }}
              onPointerCancel={() => void end()}
            >
              <Mic size={14} aria-hidden />
            </Pressable>
            <span className="chat-stack-dial mt-0.5 h-3.5 text-2xs leading-none text-text-muted">{dialKeyLabel(allCallKey)}</span>
          </div>
        ) : null}
      </div>
      <DockPinPicker
        open={picker.open}
        agentId={picker.agentId}
        onOpenChange={(open) => setPicker((prev) => ({ ...prev, open }))}
      />
      <Dialog open={Boolean(moveFor)} onOpenChange={(open) => !open && setMoveFor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t('dock.moveTitle')}</DialogTitle>
            <DialogDescription>{t('dock.moveHint')}</DialogDescription>
          </DialogHeader>
          <ConversationPicker
            excludeId={moveFor?.threadId}
            onPick={(thread) => {
              const result = moveFor
              setMoveFor(null)
              if (result) void rerouteNew(result, thread.id)
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
