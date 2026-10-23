import { Card } from '../ui/card'
import { Avatar } from '../ui/avatar'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Phone, PhoneOff } from 'lucide-react'
import { callRoutes } from '../../api/routes/calls.routes'
import { useAuth } from '../../context/AuthContext'
import {
  agentCallSession,
  bindAgentCallEnd,
  bindAgentCallHold,
  bindAgentCallMedia,
  bindAgentVoiceStart,
  callTabId,
  clearAgentCallLive,
  setAgentCallLines,
  sessionFromPayload,
  setAgentCallLive,
  setAgentCallSpeaking,
  useAgentCallUserSpeaking,
  type AgentCallLive,
  type AgentVoiceOffer,
} from '../../lib/agent-call-live'
import { openFloatingThread, useFloatingThread } from '../../lib/chat-stack'
import { addFollow, updateFollows } from '../../lib/chat-stack-follow'
import { nudgeChatStack } from '../../lib/chat-stack'
import { onGatewayEvent } from '../../lib/gateway'
import { setLauncherSuppressed } from '../../lib/personal-assistant-widget'
import { apiGet, apiPost } from '../../lib/api'
import {
  postCallTool,
  playRingTone,
  startAgentCallAudio,
  stopRingTone,
  type CallTranscriptLine,
  type LiveCall,
} from '../../lib/agent-call-audio'
import { useAgents } from '../../hooks/useAgents'
import { Button } from '../ui/button'

type CallPayload = {
  call_id: string
  status: string
  user_id: string
  signal_id?: string
  agent_id?: string
  agent_name?: string
  title?: string
  summary?: string
  text?: string
  instructions?: string
  ring_until?: string | null
}

type Phase = 'ringing' | 'connecting' | 'live' | 'error'

function asCall(data: Record<string, unknown>): CallPayload | null {
  const callId = typeof data.call_id === 'string' ? data.call_id : ''
  const userId = typeof data.user_id === 'string' ? data.user_id : ''
  const status = typeof data.status === 'string' ? data.status : ''
  if (!callId || !userId || !status) return null
  return {
    call_id: callId,
    status,
    user_id: userId,
    signal_id: typeof data.signal_id === 'string' ? data.signal_id : '',
    agent_id: typeof data.agent_id === 'string' ? data.agent_id : '',
    agent_name: typeof data.agent_name === 'string' ? data.agent_name : '',
    title: typeof data.title === 'string' ? data.title : '',
    summary: typeof data.summary === 'string' ? data.summary : '',
    text: typeof data.text === 'string' ? data.text : '',
    instructions: typeof data.instructions === 'string' ? data.instructions : '',
    ring_until: typeof data.ring_until === 'string' ? data.ring_until : null,
  }
}

function followScope(
  user: {
    uuid?: string | null
    id?: string | number | null
    organisationId?: string | null
    tenant?: { slug?: string | null } | null
  } | null,
) {
  if (!user) return null
  return `${user.uuid ?? user.id}:${user.organisationId ?? user.tenant?.slug ?? ''}`
}

function toLive(call: CallPayload, status: AgentCallLive['status']): AgentCallLive | null {
  const signalId = (call.signal_id || '').trim()
  if (!signalId) return null
  return {
    callId: call.call_id,
    signalId,
    agentId: call.agent_id || '',
    status,
    agentName: call.agent_name || '',
    title: call.title || '',
    summary: call.summary || '',
    ringUntil: call.ring_until ?? null,
  }
}

/** Put the conversation in the chat stack and nudge its card. */
function surfaceOnStack(scope: string | null, signalId: string) {
  if (!signalId) return
  if (scope) updateFollows(scope, (prev) => addFollow(prev, signalId, Date.now()))
  nudgeChatStack(signalId)
}

export default function AgentCallOverlay() {
  const { t } = useTranslation('communication')
  const { user } = useAuth()
  const floating = useFloatingThread()
  const { agents } = useAgents()
  const userId = user?.uuid ?? null
  const scope = followScope(user)
  const [call, setCall] = useState<CallPayload | null>(null)
  const [phase, setPhase] = useState<Phase>('ringing')
  const [error, setError] = useState('')
  const [speaking, setSpeaking] = useState(false)
  const userSpeaking = useAgentCallUserSpeaking()
  const liveRef = useRef<LiveCall | null>(null)
  const linesRef = useRef<CallTranscriptLine[]>([])
  const joiningRef = useRef(false)
  const panelRef = useRef<HTMLDivElement>(null)
  // The call that owns the voice line. A later ring must not replace it.
  const sessionIdRef = useRef<string | null>(null)
  // True only in the tab that was given the voice session.
  const holdsLineRef = useRef(false)
  const pushTalkRef = useRef(false)
  const [ring, setRing] = useState<CallPayload | null>(null)
  const ringRef = useRef<CallPayload | null>(null)
  ringRef.current = ring

  const clearLive = useCallback(() => {
    holdsLineRef.current = false
    liveRef.current?.stop()
    liveRef.current = null
  }, [])

  const dismiss = useCallback(() => {
    clearLive()
    linesRef.current = []
    sessionIdRef.current = null
    pushTalkRef.current = false
    setRing(null)
    clearAgentCallLive()
    stopRingTone()
    setCall(null)
    setPhase('ringing')
    setError('')
    setSpeaking(false)
    setAgentCallSpeaking(false)
  }, [clearLive])

  const markSpeaking = useCallback((next: boolean) => {
    setSpeaking(next)
    setAgentCallSpeaking(next)
  }, [])

  const publishLive = useCallback((next: CallPayload, status: AgentCallLive['status']) => {
    const live = toLive(next, status)
    if (live) setAgentCallLive(live)
  }, [])

  const startLine = useCallback(
    async (next: CallPayload, clientSecret: string, opts?: { keepLines?: boolean }) => {
      clearLive()
      holdsLineRef.current = true
      if (!opts?.keepLines) linesRef.current = []
      const audio = await startAgentCallAudio({
        clientSecret,
        onTool: (name, args) =>
          postCallTool(
            next.call_id,
            name,
            name === 'hang_up' ? { ...args, transcript: linesRef.current } : args,
          ),
        onHangUp: () => {
          const transcript = linesRef.current
          void apiPost(callRoutes.end(next.call_id), { transcript }).catch(() => {})
          dismiss()
        },
        onLines: (lines) => {
          linesRef.current = lines
          setAgentCallLines(lines)
        },
        onSpeaking: markSpeaking,
        pushToTalk: pushTalkRef.current,
      })
      if (agentCallSession()?.muted) audio.setMuted(true)
      liveRef.current = audio
      sessionIdRef.current = next.call_id
      bindAgentCallMedia({
        setMuted: (muted) => audio.setMuted(muted),
        updateSession: (update) => audio.updateSession(update),
        restart: (secret) => {
          setPhase('connecting')
          publishLive(next, 'connecting')
          void startLine(next, secret, { keepLines: true }).catch((err: unknown) => {
            setPhase('error')
            setError(err instanceof Error ? err.message : t('agentCall.voiceFailed'))
          })
        },
      })
      setRing(null)
      setPhase('live')
      publishLive(next, 'live')
    },
    [clearLive, dismiss, markSpeaking, publishLive, t],
  )

  const rejoin = useCallback(
    async (next: CallPayload) => {
      if (joiningRef.current || liveRef.current) return
      if (document.visibilityState !== 'visible') return
      joiningRef.current = true
      sessionIdRef.current = next.call_id
      setPhase('connecting')
      publishLive(next, 'connecting')
      setError('')
      try {
        const session = await apiPost<{
          client_secret: string
          voice?: string
          speed?: number
          language?: string
          voices?: { id: string; label: string }[]
          speeds?: number[]
          languages?: string[]
        }>(callRoutes.resume(next.call_id), { client_id: callTabId() })
        sessionFromPayload(session, { resetLines: true })
        await startLine(next, session.client_secret)
      } catch (err) {
        const message = err instanceof Error ? err.message : t('agentCall.voiceFailed')
        holdsLineRef.current = false
        if (/\b409\b|another tab|not live/i.test(message)) {
          dismiss()
          return
        }
        setPhase('error')
        setError(message)
      } finally {
        joiningRef.current = false
      }
    },
    [dismiss, publishLive, startLine, t],
  )

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    const load = (attempt: number) => {
      void apiGet<CallPayload[]>(callRoutes.ringing)
        .then((rows) => {
          if (cancelled || !rows?.length) return
          const liveRow = rows.find((row) => row.status === 'live')
          const ringRow = rows.find((row) => row.status === 'ringing')
          if (liveRow) {
            // Only the visible tab may open the voice line. A background tab
            // stays quiet so the same agent is not on the call twice.
            if (document.visibilityState !== 'visible') return
            setCall(liveRow)
            sessionIdRef.current = liveRow.call_id
            surfaceOnStack(scope, liveRow.signal_id || '')
            publishLive(liveRow, 'live')
            void rejoin(liveRow)
            return
          }
          const next = ringRow ?? rows[0]
          setRing(null)
          setCall(next)
          surfaceOnStack(scope, next.signal_id || '')
          setPhase('ringing')
          publishLive(next, 'ringing')
          if (document.visibilityState === 'visible') playRingTone()
        })
        .catch(() => {
          if (cancelled || attempt >= 2) return
          window.setTimeout(() => load(attempt + 1), 800)
        })
    }
    load(0)
    return () => {
      cancelled = true
    }
  }, [userId, scope, publishLive, rejoin])

  useEffect(() => {
    if (!userId) return
    return onGatewayEvent('notifications', (event) => {
      if (event.event !== 'agent.call') return
      const next = asCall(event.data)
      if (!next || next.user_id !== userId) return
      if (next.status === 'speak' || next.status === 'live') {
        const ours =
          holdsLineRef.current &&
          (!sessionIdRef.current || sessionIdRef.current === next.call_id)
        if (ours) {
          if (next.instructions) liveRef.current?.updateSession({ instructions: next.instructions })
          if (next.text) liveRef.current?.speak(next.text)
          return
        }
        if (joiningRef.current && next.call_id === sessionIdRef.current) return
        // Another tab has the agent. Do not open a second voice session.
        stopRingTone()
        setRing(null)
        if (!holdsLineRef.current) {
          clearAgentCallLive(next.call_id)
          setCall((current) => (current?.call_id === next.call_id ? null : current))
        }
        return
      }
      if (next.status === 'ringing') {
        // One line at a time. A ring while this call is up is ignored.
        if (sessionIdRef.current && sessionIdRef.current !== next.call_id) return
        setRing(null)
        setCall(next)
        setPhase('ringing')
        setError('')
        publishLive(next, 'ringing')
        surfaceOnStack(scope, next.signal_id || '')
        if (document.visibilityState === 'visible') playRingTone()
        return
      }
      if (next.status === 'missed' || next.status === 'declined' || next.status === 'ended') {
        if (ringRef.current?.call_id === next.call_id) {
          setRing(null)
          stopRingTone()
          return
        }
        if (sessionIdRef.current && sessionIdRef.current !== next.call_id) return
        // The server closed the line. The voice session used to keep talking
        // after that. Leave a short beat so a goodbye can finish, then drop it.
        const closedId = next.call_id
        window.setTimeout(() => {
          if (sessionIdRef.current && sessionIdRef.current !== closedId) return
          clearAgentCallLive(closedId)
          dismiss()
        }, 900)
      }
    })
  }, [userId, scope, dismiss, publishLive])

  useEffect(() => {
    if (!call || phase !== 'ringing' || call.status === 'live' || !call.ring_until) return
    // Server sends naive UTC iso; without a Z, Date.parse treats it as local
    // and the ring looks already expired in positive-offset timezones.
    const raw = call.ring_until.trim()
    const until = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw}Z`)
    if (!Number.isFinite(until)) return
    const wait = Math.max(0, until - Date.now())
    const timer = window.setTimeout(() => {
      void apiPost(callRoutes.miss(call.call_id), {}).catch(() => {})
      dismiss()
    }, wait)
    return () => window.clearTimeout(timer)
  }, [call, phase, dismiss])

  useEffect(() => {
    if (!ring?.ring_until) return
    const raw = ring.ring_until.trim()
    const until = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) ? raw : `${raw}Z`)
    if (!Number.isFinite(until)) return
    const id = ring.call_id
    const wait = Math.max(0, until - Date.now())
    const timer = window.setTimeout(() => {
      void apiPost(callRoutes.miss(id), {}).catch(() => {})
      setRing((current) => (current?.call_id === id ? null : current))
      stopRingTone()
    }, wait)
    return () => window.clearTimeout(timer)
  }, [ring])

  useEffect(() => {
    return () => {
      liveRef.current?.stop()
      clearAgentCallLive()
    }
  }, [])

  // Call takes the corner: hide the Bokito launcher while a call is on screen.
  useEffect(() => {
    if (!call) return
    setLauncherSuppressed(true)
    return () => setLauncherSuppressed(false)
  }, [call])

  const decline = () => {
    const incoming = ringRef.current
    if (incoming && sessionIdRef.current && incoming.call_id !== sessionIdRef.current) {
      void apiPost(callRoutes.decline(incoming.call_id), {}).catch(() => {})
      setRing(null)
      stopRingTone()
      return
    }
    if (!call) return
    void apiPost(callRoutes.decline(call.call_id), {}).catch(() => {})
    dismiss()
  }

  const hangUp = useCallback(() => {
    if (!call) return
    const transcript = linesRef.current
    void apiPost(callRoutes.end(call.call_id), { transcript }).catch(() => {})
    dismiss()
  }, [call, dismiss])

  useEffect(() => {
    bindAgentCallEnd(hangUp)
    return () => bindAgentCallEnd(null)
  }, [hangUp])

  useEffect(() => {
    bindAgentCallHold((held) => liveRef.current?.setHeld(held))
    return () => bindAgentCallHold(null)
  }, [])

  useEffect(() => {
    if (phase !== 'live' || !call || !holdsLineRef.current) return
    const id = call.call_id
    const beat = () => {
      void apiPost(callRoutes.hold(id), { client_id: callTabId() }).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : ''
        if (/another tab/i.test(message)) dismiss()
      })
    }
    beat()
    const timer = window.setInterval(beat, 8000)
    return () => window.clearInterval(timer)
  }, [phase, call, dismiss])

  useEffect(() => {
    const begin = (offer: AgentVoiceOffer) => {
      if (sessionIdRef.current) return
      const payload: CallPayload = {
        call_id: offer.call_id,
        status: 'live',
        user_id: offer.user_id,
        signal_id: offer.signal_id,
        agent_id: offer.agent_id || '',
        agent_name: offer.agent_name || '',
        title: offer.title || '',
        summary: offer.summary || '',
      }
      setRing(null)
      setCall(payload)
      setPhase('connecting')
      setError('')
      pushTalkRef.current = Boolean(offer.pushToTalk)
      sessionFromPayload(offer, { resetLines: true })
      publishLive(payload, 'connecting')
      sessionIdRef.current = payload.call_id
      surfaceOnStack(scope, payload.signal_id || '')
      void startLine(payload, offer.client_secret).catch((err: unknown) => {
        sessionIdRef.current = null
        clearLive()
        setPhase('error')
        setError(err instanceof Error ? err.message : t('agentCall.voiceFailed'))
      })
    }
    bindAgentVoiceStart(begin)
    return () => bindAgentVoiceStart(null)
  }, [publishLive, scope, startLine, t])

  const accept = async (incoming?: CallPayload) => {
    const target = incoming ?? call
    if (!target) return
    if (incoming && sessionIdRef.current && sessionIdRef.current !== incoming.call_id) {
      const transcript = linesRef.current
      void apiPost(callRoutes.end(sessionIdRef.current), { transcript }).catch(() => {})
      clearLive()
      linesRef.current = []
      clearAgentCallLive(sessionIdRef.current)
      sessionIdRef.current = null
    }
    holdsLineRef.current = true
    setRing(null)
    setCall(target)
    stopRingTone()
    setPhase('connecting')
    publishLive(target, 'connecting')
    setError('')
    try {
      const session = await apiPost<{
        client_secret: string
        model: string
        voice?: string
        speed?: number
        language?: string
        voices?: { id: string; label: string }[]
        speeds?: number[]
        languages?: string[]
      }>(callRoutes.accept(target.call_id), { client_id: callTabId() })
      pushTalkRef.current = false
      sessionFromPayload(session, { resetLines: true })
      await startLine(target, session.client_secret)
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      clearLive()
      sessionIdRef.current = null
      clearAgentCallLive(target.call_id)
      if (/another tab|not ringing/i.test(message)) {
        dismiss()
        return
      }
      setPhase('error')
      setError(message || t('agentCall.voiceFailed'))
    }
  }

  const corner = ring ?? call
  if (!corner) return null

  const showingRing = Boolean(ring) || phase === 'ringing' || phase === 'error'
  const name = corner.agent_name || t('agentCall.agent')
  const live = !showingRing && (phase === 'live' || phase === 'connecting')
  if (live) return null

  const openThread = () => {
    if (!corner.signal_id) return
    openFloatingThread(corner.signal_id, panelRef.current?.getBoundingClientRect() ?? null)
  }
  const agent = agents.find((row) => row.id === corner.agent_id)
  const motion = speaking ? 'talking' : live && userSpeaking ? 'listening' : 'idle'

  return (
    <div
      className={
        showingRing && floating
          ? 'fixed top-20 right-4 z-[80] w-[min(100vw-2rem,22rem)]'
          : 'fixed bottom-4 right-4 z-[80] w-[min(100vw-2rem,22rem)]'
      }
      role="dialog"
      aria-modal="true"
      aria-labelledby="agent-call-title"
    >
      <Card padding="default"
        ref={panelRef}
        className="w-full max-w-sm cursor-pointer"
        onClick={() => {
          if (showingRing) {
            void accept(ring ?? undefined)
            return
          }
          openThread()
        }}
      >
        <div className="flex items-center gap-3">
          <Avatar
            kind="agent"
            agent={{
              name: agent?.name || name,
              avatar_kind: agent?.avatar_kind,
              avatar_icon: agent?.avatar_icon,
              avatar_color: agent?.avatar_color,
              avatar_shape: agent?.avatar_shape,
              avatar_image_url: agent?.avatar_image_url,
            }}
            size={64}
            mode="live"
            motion={motion}
            decorative
          />
          <div className="min-w-0">
            <p id="agent-call-title" className="truncate-fade text-base font-medium text-text-heading">
              {t(live ? 'agentCall.liveTitle' : 'agentCall.ringTitle', { name })}
            </p>
            <p className="truncate-fade text-sm text-text-secondary">{corner.title}</p>
          </div>
        </div>
        {corner.summary ? (
          <p className="mt-3 text-sm text-text-secondary">{corner.summary}</p>
        ) : null}
        {error ? <p className="mt-3 text-sm text-status-error">{error}</p> : null}
        <div className="mt-4 flex gap-2" onClick={(event) => event.stopPropagation()}>
          {showingRing ? (
            <>
              <Button type="button" variant="secondary" className="flex-1" onClick={decline}>
                <PhoneOff className="h-4 w-4" />
                {t('agentCall.decline')}
              </Button>
              <Button type="button" className="flex-1" onClick={() => void accept(ring ?? undefined)}>
                <Phone className="h-4 w-4" />
                {t('agentCall.answer')}
              </Button>
            </>
          ) : (
            <Button type="button" variant="destructive" className="flex-1" onClick={hangUp} disabled={phase === 'connecting'}>
              <PhoneOff className="h-4 w-4" />
              {phase === 'connecting' ? t('agentCall.connecting') : t('agentCall.hangUp')}
            </Button>
          )}
        </div>
      </Card>
    </div>
  )
}
