import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Phone, PhoneOff } from 'lucide-react'
import { callRoutes } from '../../api/routes/calls.routes'
import { useAuth } from '../../context/AuthContext'
import { onGatewayEvent } from '../../lib/gateway'
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
    agent_name: typeof data.agent_name === 'string' ? data.agent_name : '',
    title: typeof data.title === 'string' ? data.title : '',
    summary: typeof data.summary === 'string' ? data.summary : '',
    text: typeof data.text === 'string' ? data.text : '',
    ring_until: typeof data.ring_until === 'string' ? data.ring_until : null,
  }
}

export default function AgentCallOverlay() {
  const { t } = useTranslation('communication')
  const { user } = useAuth()
  const userId = user?.uuid ?? null
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
    setCall(null)
    setPhase('ringing')
    setError('')
  }, [clearLive])

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    void apiGet<CallPayload[]>(callRoutes.ringing)
      .then((rows) => {
        if (cancelled || !rows?.length) return
        setCall(rows[0])
        setPhase('ringing')
        void playIncomingNotificationSound()
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [userId])

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
        void playIncomingNotificationSound()
        return
      }
      if (next.status === 'missed' || next.status === 'declined' || next.status === 'ended') {
        if (liveRef.current && next.status !== 'ended') return
        dismiss()
      }
    })
  }, [userId, dismiss])

  useEffect(() => {
    if (!call || phase !== 'ringing' || !call.ring_until) return
    const until = Date.parse(call.ring_until)
    if (!Number.isFinite(until)) return
    const wait = Math.max(0, until - Date.now())
    const timer = window.setTimeout(() => {
      void apiPost(callRoutes.miss(call.call_id), {}).catch(() => {})
      dismiss()
    }, wait)
    return () => window.clearTimeout(timer)
  }, [call, phase, dismiss])

  const decline = () => {
    if (!call) return
    void apiPost(callRoutes.decline(call.call_id), {}).catch(() => {})
    dismiss()
  }

  const accept = async () => {
    if (!call) return
    setPhase('connecting')
    setError('')
    try {
      const session = await apiPost<{
        client_secret: string
        model: string
      }>(callRoutes.accept(call.call_id), {})
      const live = await startAgentCallAudio({
        clientSecret: session.client_secret,
        onTool: (name, args) => postCallTool(call.call_id, name, args),
        onLine: (line) => {
          linesRef.current = [...linesRef.current, line]
        },
      })
      liveRef.current = live
      setPhase('live')
    } catch (err) {
      clearLive()
      setPhase('error')
      setError(err instanceof Error ? err.message : t('agentCall.voiceFailed'))
    }
  }

  const hangUp = () => {
    if (!call) return
    const transcript = linesRef.current
    void apiPost(callRoutes.end(call.call_id), { transcript }).catch(() => {})
    dismiss()
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
            <p id="agent-call-title" className="truncate text-base font-medium text-text-heading">
              {t(live ? 'agentCall.liveTitle' : 'agentCall.ringTitle', { name })}
            </p>
            <p className="truncate text-sm text-text-secondary">{call.title}</p>
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
