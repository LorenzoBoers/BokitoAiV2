import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Phone, PhoneOff } from 'lucide-react'
import { callRoutes } from '../../api/routes/calls.routes'
import { useAuth } from '../../context/AuthContext'
import {
  clearAgentCallLive,
  setAgentCallLive,
  type AgentCallLive,
} from '../../lib/agent-call-live'
import { addFollow, updateFollows } from '../../lib/chat-stack-follow'
import { nudgeChatStack } from '../../lib/chat-stack'
import { onGatewayEvent } from '../../lib/gateway'
import { setLauncherSuppressed } from '../../lib/personal-assistant-widget'
import { apiGet, apiPost } from '../../lib/api'
import {
  postCallTool,
  startAgentCallAudio,
  type CallTranscriptLine,
  type LiveCall,
} from '../../lib/agent-call-audio'
import { playIncomingNotificationSound } from '../../lib/notification-sound'
import { AiAvatar } from '../ui/AiAvatar'
import { Button } from '../ui/button'

type CallPayload = {
  call_id: string
  status: string
  user_id: string
  signal_id?: string
  agent_name?: string
  title?: string
  summary?: string
  text?: string
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
    agent_name: typeof data.agent_name === 'string' ? data.agent_name : '',
    title: typeof data.title === 'string' ? data.title : '',
    summary: typeof data.summary === 'string' ? data.summary : '',
    text: typeof data.text === 'string' ? data.text : '',
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
  const userId = user?.uuid ?? null
  const scope = followScope(user)
  const [call, setCall] = useState<CallPayload | null>(null)
  const [phase, setPhase] = useState<Phase>('ringing')
  const [error, setError] = useState('')
  const liveRef = useRef<LiveCall | null>(null)
  const linesRef = useRef<CallTranscriptLine[]>([])

  const clearLive = useCallback(() => {
    liveRef.current?.stop()
    liveRef.current = null
  }, [])

  const dismiss = useCallback(() => {
    clearLive()
    linesRef.current = []
    clearAgentCallLive()
    setCall(null)
    setPhase('ringing')
    setError('')
  }, [clearLive])

  const publishLive = useCallback((next: CallPayload, status: AgentCallLive['status']) => {
    const live = toLive(next, status)
    if (live) setAgentCallLive(live)
  }, [])

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    void apiGet<CallPayload[]>(callRoutes.ringing)
      .then((rows) => {
        if (cancelled || !rows?.length) return
        const next = rows[0]
        setCall(next)
        setPhase('ringing')
        publishLive(next, 'ringing')
        surfaceOnStack(scope, next.signal_id || '')
        void playIncomingNotificationSound()
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [userId, scope, publishLive])

  useEffect(() => {
    if (!userId) return
    return onGatewayEvent('notifications', (event) => {
      if (event.event !== 'agent.call') return
      const next = asCall(event.data)
      if (!next || next.user_id !== userId) return
      if (next.status === 'speak' || (next.text && next.status === 'live')) {
        if (next.text) liveRef.current?.speak(next.text)
        return
      }
      if (next.status === 'ringing') {
        setCall(next)
        setPhase('ringing')
        setError('')
        publishLive(next, 'ringing')
        surfaceOnStack(scope, next.signal_id || '')
        void playIncomingNotificationSound()
        return
      }
      if (next.status === 'missed' || next.status === 'declined' || next.status === 'ended') {
        // An agent hang-up publishes ended while the goodbye is still
        // playing. The voice layer closes the screen when that audio ends.
        if (liveRef.current) return
        clearAgentCallLive(next.call_id)
        dismiss()
      }
    })
  }, [userId, scope, dismiss, publishLive])

  useEffect(() => {
    if (!call || phase !== 'ringing' || !call.ring_until) return
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
    return () => clearAgentCallLive()
  }, [])

  // Call takes the corner: hide the Bokito launcher while a call is on screen.
  useEffect(() => {
    if (!call) return
    setLauncherSuppressed(true)
    return () => setLauncherSuppressed(false)
  }, [call])

  const decline = () => {
    if (!call) return
    void apiPost(callRoutes.decline(call.call_id), {}).catch(() => {})
    dismiss()
  }

  const hangUp = () => {
    if (!call) return
    const transcript = linesRef.current
    void apiPost(callRoutes.end(call.call_id), { transcript }).catch(() => {})
    dismiss()
  }

  const accept = async () => {
    if (!call) return
    setPhase('connecting')
    publishLive(call, 'connecting')
    setError('')
    try {
      const session = await apiPost<{
        client_secret: string
        model: string
      }>(callRoutes.accept(call.call_id), {})
      const live = await startAgentCallAudio({
        clientSecret: session.client_secret,
        onTool: (name, args) =>
          postCallTool(
            call.call_id,
            name,
            name === 'hang_up' ? { ...args, transcript: linesRef.current } : args,
          ),
        onHangUp: () => hangUp(),
        onLine: (line) => {
          linesRef.current = [...linesRef.current, line]
        },
      })
      liveRef.current = live
      setPhase('live')
      publishLive(call, 'live')
    } catch (err) {
      clearLive()
      clearAgentCallLive(call.call_id)
      setPhase('error')
      setError(err instanceof Error ? err.message : t('agentCall.voiceFailed'))
    }
  }

  if (!call) return null

  const name = call.agent_name || t('agentCall.agent')
  const live = phase === 'live' || phase === 'connecting'

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center scrim p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="agent-call-title"
    >
      <div className="panel w-full max-w-sm p-5">
        <div className="flex items-center gap-3">
          <AiAvatar name={name} seed={call.call_id} size={48} activity={live ? 'working' : 'standby'} />
          <div className="min-w-0">
            <p id="agent-call-title" className="truncate-fade text-base font-medium text-text-heading">
              {t(live ? 'agentCall.liveTitle' : 'agentCall.ringTitle', { name })}
            </p>
            <p className="truncate-fade text-sm text-text-secondary">{call.title}</p>
          </div>
        </div>
        {call.summary ? (
          <p className="mt-3 text-sm text-text-secondary">{call.summary}</p>
        ) : null}
        {error ? <p className="mt-3 text-sm text-status-error">{error}</p> : null}
        <div className="mt-4 flex gap-2">
          {phase === 'ringing' || phase === 'error' ? (
            <>
              <Button type="button" variant="secondary" className="flex-1" onClick={decline}>
                <PhoneOff className="h-4 w-4" />
                {t('agentCall.decline')}
              </Button>
              <Button type="button" className="flex-1" onClick={() => void accept()}>
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
      </div>
    </div>
  )
}
