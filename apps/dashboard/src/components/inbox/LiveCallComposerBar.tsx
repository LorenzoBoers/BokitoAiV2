import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { List, Mic, MicOff, PhoneOff, Settings } from 'lucide-react'
import { toast } from 'sonner'
import { callRoutes } from '../../api/routes/calls.routes'
import { useAuth } from '../../context/AuthContext'
import { useAgents } from '../../hooks/useAgents'
import { apiPost } from '../../lib/api'
import {
  agentCallLevel,
  callTabId,
  requestAgentCallEnd,
  requestAgentCallMute,
  agentCallPushToTalk,
  requestAgentCallRestart,
  requestAgentCallSessionUpdate,
  sessionFromPayload,
  useAgentCallLive,
  useAgentCallSession,
  useAgentCallSpeaking,
  useAgentCallUserSpeaking,
} from '../../lib/agent-call-live'
import { CHAT_COLUMN_CLASS } from '../../lib/chat-layout'
import { cn } from '../../lib/utils'
import { AiAvatar } from '../ui/AiAvatar'
import ScrollFade from '../ui/ScrollFade'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'

type SettingsResult = {
  voice: string
  speed: number
  language: string
  instructions: string
  reconnect: boolean
  client_secret?: string
  voices?: { id: string; label: string }[]
  speeds?: number[]
  languages?: string[]
}

const WAVE_HEIGHT = 32
const WAVE_GREEN = 'rgb(var(--color-status-success))'
/** Same wavelength and scroll as the dictation meter (about 58px, 4s across). */
const WAVE_LENGTH = 144 / 2.5
const WAVE_SPEED = 0.6

function wavePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return ''
  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`
  for (let i = 1; i < points.length - 1; i++) {
    const xc = (points[i].x + points[i + 1].x) / 2
    const yc = (points[i].y + points[i + 1].y) / 2
    d += ` Q ${points[i].x.toFixed(2)} ${points[i].y.toFixed(2)} ${xc.toFixed(2)} ${yc.toFixed(2)}`
  }
  const last = points[points.length - 1]
  d += ` L ${last.x.toFixed(2)} ${last.y.toFixed(2)}`
  return d
}

/** Dictation wave, stretched from the agent name to the call buttons. */
function CallSpectrum() {
  const hostRef = useRef<SVGSVGElement>(null)
  const pathRef = useRef<SVGPathElement>(null)

  useEffect(() => {
    const host = hostRef.current
    const path = pathRef.current
    if (!host || !path) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    let stopped = false
    const history = new Float32Array(800)
    const halfOf = new Int16Array(800)
    const halfAmp = new Map<number, number>()
    let samples = 48
    let head = 0
    let pending = 0
    let phase = 0
    let level = 0
    let halfId = 0
    let halfSum = 0
    let halfCount = 0
    let width = 144
    const tick = () => {
      if (stopped) return
      const nextWidth = Math.max(80, Math.round(host.clientWidth || width))
      const nextSamples = Math.max(48, Math.min(800, Math.round(nextWidth / 3)))
      if (nextSamples !== samples || nextWidth !== width) {
        samples = nextSamples
        width = nextWidth
        host.setAttribute('viewBox', `0 0 ${width} ${WAVE_HEIGHT}`)
        head = 0
        phase = 0
        halfId = 0
        halfSum = 0
        halfCount = 0
        halfAmp.clear()
      }
      const target = reduced ? 0 : Math.max(0, Math.min(1, agentCallLevel()))
      const follow = target > level ? 0.85 : 0.4
      level += (target - level) * follow
      halfSum += level
      halfCount += 1
      halfAmp.set(halfId, halfSum / halfCount)
      const phaseStep = ((width / WAVE_LENGTH) * Math.PI * 2) / samples
      const scroll = (WAVE_SPEED * samples) / width
      pending += reduced ? 0 : scroll
      const steps = Math.min(samples, Math.floor(pending))
      pending -= steps
      for (let s = 0; s < steps; s++) {
        phase += phaseStep
        const nextHalf = Math.floor(phase / Math.PI)
        if (nextHalf !== halfId) {
          halfId = nextHalf
          halfSum = level
          halfCount = 1
          halfAmp.set(halfId, level)
          if (halfAmp.size > 24) {
            const keep = halfId - 16
            for (const key of halfAmp.keys()) {
              if (key < keep) halfAmp.delete(key)
            }
          }
        }
        history[head % samples] = Math.sin(phase)
        halfOf[head % samples] = halfId
        head = (head + 1) % samples
      }
      const points: Array<{ x: number; y: number }> = []
      const mid = WAVE_HEIGHT / 2
      const amp = 13
      for (let i = 0; i < samples; i++) {
        const t = (i - pending) / (samples - 1)
        if (t < 0) continue
        const fade = t < 0.08 ? Math.sin((t / 0.08) * (Math.PI / 2)) : 1
        const at = (head + i) % samples
        const sample = history[at] * (halfAmp.get(halfOf[at]) ?? 0)
        points.push({ x: t * width, y: mid - sample * amp * fade })
      }
      const tipPhase = phase + pending * phaseStep
      const tip = Math.sin(tipPhase) * (halfAmp.get(Math.floor(tipPhase / Math.PI)) ?? level)
      points.push({ x: width, y: mid - tip * amp })
      path.setAttribute('d', wavePath(points))
      raf = window.requestAnimationFrame(tick)
    }
    raf = window.requestAnimationFrame(tick)
    return () => {
      stopped = true
      window.cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <svg
      ref={hostRef}
      viewBox={`0 0 144 ${WAVE_HEIGHT}`}
      preserveAspectRatio="none"
      className="h-8 min-w-0 flex-1"
      aria-hidden
    >
      <path
        ref={pathRef}
        d={`M 0 ${WAVE_HEIGHT / 2} L 144 ${WAVE_HEIGHT / 2}`}
        fill="none"
        stroke={WAVE_GREEN}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

function speedLabel(speed: number) {
  const text = Number.isInteger(speed) ? String(speed) : String(speed)
  return `${text}x`
}

/**
 * Live call, shown above the thread composer. Mute, transcript, voice,
 * speed and language sit on this line. Hang-up stays with the call overlay.
 */
export default function LiveCallComposerBar({ threadId }: { threadId: string }) {
  const { t } = useTranslation('communication')
  const call = useAgentCallLive()
  const speaking = useAgentCallSpeaking()
  const userSpeaking = useAgentCallUserSpeaking()
  const prefs = useAgentCallSession()
  const { agents } = useAgents()
  const { user } = useAuth()
  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const transcriptRef = useRef<HTMLDivElement>(null)
  const lineCount = prefs?.lines.length ?? 0
  useEffect(() => {
    const el = transcriptRef.current
    if (!el || !transcriptOpen) return
    el.scrollTop = el.scrollHeight
  }, [lineCount, transcriptOpen])
  if (!call || call.signalId !== threadId) return null
  if (call.status !== 'live' && call.status !== 'connecting') return null

  const agent = agents.find((row) => row.id === call.agentId)
  const name = agent?.name || call.agentName || t('agentCall.agent')
  const live = call.status === 'live'
  const muted = Boolean(prefs?.muted)
  const voiceLabel = prefs?.voices.find((row) => row.id === prefs.voice)?.label || prefs?.voice || ''
  const languageLabel = prefs?.language ? t(`agentCall.languageName.${prefs.language}`) : ''

  const apply = (patch: { voice?: string; speed?: number; language?: string }) => {
    if (!live || saving) return
    setSaving(true)
    void apiPost<SettingsResult>(callRoutes.settings(call.callId), {
      ...patch,
      client_id: callTabId(),
      push_to_talk: agentCallPushToTalk(),
    })
      .then((result) => {
        sessionFromPayload(result)
        if (result.reconnect && result.client_secret) {
          requestAgentCallRestart(result.client_secret)
          return
        }
        requestAgentCallSessionUpdate({
          instructions: result.instructions,
          speed: result.speed,
          language: result.language,
        })
      })
      .catch((err: unknown) => {
        toast.error(formatApiErrorMessage(err, t('agentCall.voiceFailed')))
      })
      .finally(() => setSaving(false))
  }

  const iconClass =
    'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-bg-hover hover:text-text-primary disabled:opacity-40'

  return (
    <div className="relative z-20 shrink-0 bg-bg px-4 pt-2">
      <div className={`${CHAT_COLUMN_CLASS} rounded-lg border border-border/70 bg-bg-elevated`}>
        {transcriptOpen ? (
          <ScrollFade
            ref={transcriptRef}
            fadeColorVar="--color-bg-elevated"
            wrapperClassName="border-b border-border/60"
            className="max-h-40 px-3 py-2"
          >
            {prefs?.lines.length ? (
              <ul className="space-y-2">
                {prefs.lines.map((line, index) => {
                  const mine = line.role === 'user'
                  return (
                    <li
                      key={`${index}-${line.role}`}
                      className={cn(
                        'flex max-w-[85%] flex-col text-xs',
                        mine ? 'ml-auto items-end text-right' : 'mr-auto items-start text-left',
                      )}
                    >
                      <span className="text-text-muted">{mine ? user?.name?.trim() || t('agentCall.you') : name}</span>
                      <p className={mine ? 'text-text-primary' : 'text-text-secondary'}>{line.text}</p>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="text-xs text-text-muted">{t('agentCall.transcriptEmpty')}</p>
            )}
          </ScrollFade>
        ) : null}
        <div className="flex items-center gap-2 px-2 py-1.5">
          <AiAvatar
            name={name}
            kind={agent?.avatar_kind}
            icon={agent?.avatar_icon}
            color={agent?.avatar_color}
            shape={agent?.avatar_shape}
            imageUrl={agent?.avatar_image_url}
            size={28}
            mode="live"
            motion={speaking ? 'talking' : userSpeaking ? 'listening' : 'idle'}
            decorative
          />
          <div className="min-w-0 max-w-[42%] shrink">
            <p className="truncate-fade text-xs font-medium text-text-heading">{name}</p>
            <p className="truncate-fade text-2xs text-text-muted">
              {!live
                ? t('agentCall.connecting')
                : muted
                  ? t('agentCall.muted')
                  : speaking
                    ? t('agentCall.speaking')
                    : t('agentCall.listening')}
            </p>
          </div>
          <CallSpectrum />
          <button
            type="button"
            className={iconClass}
            disabled={!live}
            aria-pressed={muted}
            title={muted ? t('agentCall.unmute') : t('agentCall.mute')}
            aria-label={muted ? t('agentCall.unmute') : t('agentCall.mute')}
            onClick={() => requestAgentCallMute(!muted)}
          >
            {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={iconClass}
                disabled={!live || saving}
                title={t('agentCall.settings')}
                aria-label={t('agentCall.settings')}
              >
                <Settings className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end" className="z-[100] min-w-[220px]">
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <span>{t('agentCall.voice')}</span>
                  <span className="ml-auto text-text-muted">{voiceLabel}</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup value={prefs?.voice} onValueChange={(voice) => apply({ voice })}>
                    {(prefs?.voices ?? []).map((row) => (
                      <DropdownMenuRadioItem key={row.id} value={row.id}>
                        {row.label}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <span>{t('agentCall.speed')}</span>
                  <span className="ml-auto text-text-muted">
                    {prefs ? speedLabel(prefs.speed) : ''}
                  </span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={prefs ? String(prefs.speed) : ''}
                    onValueChange={(value) => apply({ speed: Number(value) })}
                  >
                    {(prefs?.speeds ?? []).map((speed) => (
                      <DropdownMenuRadioItem key={speed} value={String(speed)}>
                        {speedLabel(speed)}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <span>{t('agentCall.language')}</span>
                  <span className="ml-auto text-text-muted">{languageLabel}</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuRadioGroup
                    value={prefs?.language}
                    onValueChange={(language) => apply({ language })}
                  >
                    {(prefs?.languages ?? []).map((code) => (
                      <DropdownMenuRadioItem key={code} value={code}>
                        {t(`agentCall.languageName.${code}`)}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            type="button"
            className={`${iconClass} ${transcriptOpen ? 'bg-bg-hover text-text-primary' : ''}`}
            disabled={!live}
            aria-pressed={transcriptOpen}
            title={t('agentCall.transcript')}
            aria-label={t('agentCall.transcript')}
            onClick={() => setTranscriptOpen((open) => !open)}
          >
            <List className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-status-error transition-colors hover:bg-status-error/10 disabled:opacity-40"
            onClick={() => requestAgentCallEnd()}
            disabled={!live}
            title={live ? t('agentCall.hangUp') : t('agentCall.connecting')}
            aria-label={live ? t('agentCall.hangUp') : t('agentCall.connecting')}
          >
            <PhoneOff className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
