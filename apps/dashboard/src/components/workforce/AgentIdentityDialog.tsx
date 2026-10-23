import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from '../ui/dialog'
import { AiAvatar } from '../ui/AiAvatar'
import { AgentGlow } from '../ui/agent-glow'
import { BlurbEdit, NameEdit } from '../ui/NameEdit'
import { Tip } from '../ui/Tip'
import { useAuth } from '../../context/AuthContext'
import { reloadAgentsCache } from '../../hooks/useAgents'
import { bokitoPreviewAgentVoice, bokitoUpdateAgent } from '../../lib/bokito-api'
import {
  agentProfileAccentColor,
  DEFAULT_AGENT_AVATAR_COLOR,
  resolveAgentAvatarColor,
  resolveAgentAvatarShape,
  type AgentAvatarKind,
} from '../../lib/agent-avatar'
import { useLocalOrbPreview } from '../../hooks/useBotOrbPulse'
import { AgentVisualEditor } from './AgentVisualEditor'

/** Showcase mark — matches the agent profile hero, sized for a modal. */
const PREVIEW_SIZE = 96

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  agentId: string
  agentName: string
  agentJobTitle?: string | null
  agentDescription?: string | null
  avatarKind?: string | null
  avatarIcon?: string | null
  avatarColor?: string | null
  avatarShape?: string | null
  callVoice?: string | null
  callSpeed?: number | null
  callLanguage?: string | null
  callVoices?: { id: string; label: string }[]
  callSpeeds?: number[]
  callLanguages?: string[]
  onChanged?: () => void
}

const MAX_JOB_TITLE = 32
const MAX_DESCRIPTION = 280

function speedLabel(speed: number) {
  const text = Number.isInteger(speed) ? String(speed) : String(speed)
  return `${text}x`
}

function editorKind(value: string | null | undefined): 'initials' | 'orb' {
  const kind = (value ?? '').trim().toLowerCase() as AgentAvatarKind | ''
  // Bot (orb) is the product default; initials/icons are the secondary option.
  if (kind === 'initials' || kind === 'icon' || kind === 'image') return 'initials'
  return 'orb'
}

/** Name, job title, optional description and bot mark (shape + color) or initials. */
export function AgentIdentityDialog({
  open,
  onOpenChange,
  agentId,
  agentName,
  agentJobTitle,
  agentDescription,
  avatarKind,
  avatarIcon: _avatarIcon,
  avatarColor,
  avatarShape,
  callVoice,
  callSpeed,
  callLanguage,
  callVoices,
  callSpeeds,
  callLanguages,
  onChanged,
}: Props) {
  const { t } = useTranslation('nav')
  const { t: tc } = useTranslation()
  const { t: tCall } = useTranslation('communication')
  const { token, user } = useAuth()
  const showVoice = Boolean(user?.agentCallsEnabled && callVoices?.length)
  const [name, setName] = useState(agentName)
  const [jobTitle, setJobTitle] = useState(agentJobTitle ?? '')
  const [description, setDescription] = useState(agentDescription ?? '')
  const [kind, setKind] = useState<'initials' | 'orb'>(editorKind(avatarKind))
  const [color, setColor] = useState(resolveAgentAvatarColor(avatarColor))
  const [shape, setShape] = useState(resolveAgentAvatarShape(avatarShape))
  const [voice, setVoice] = useState(callVoice || '')
  const [speed, setSpeed] = useState(callSpeed ?? 1)
  const [language, setLanguage] = useState(callLanguage || 'nl')
  const [editingName, setEditingName] = useState(false)
  const [editingJobTitle, setEditingJobTitle] = useState(false)
  const [editingDescription, setEditingDescription] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameAtEditStart = useRef(agentName)
  const jobAtEditStart = useRef(agentJobTitle ?? '')
  const descriptionAtEditStart = useRef(agentDescription ?? '')
  const orbPreview = useLocalOrbPreview('idle')
  const previewAudio = useRef<HTMLAudioElement | null>(null)
  const previewGen = useRef(0)
  const showMotion = user?.environment === 'dev'

  useEffect(() => {
    return () => {
      previewGen.current += 1
      previewAudio.current?.pause()
      previewAudio.current = null
      orbPreview.play('idle')
    }
  }, [open])

  const hearVoice = (next: { voice?: string; speed?: number; language?: string }) => {
    if (!token || !showVoice) return
    const voiceId = next.voice ?? voice
    const pace = next.speed ?? speed
    const lang = next.language ?? language
    if (!voiceId) return
    const gen = ++previewGen.current
    previewAudio.current?.pause()
    void bokitoPreviewAgentVoice(token, {
      voice: voiceId,
      speed: pace,
      language: lang,
      name: name.trim() || agentName,
    })
      .then((blob) => {
        if (gen !== previewGen.current) return
        const url = URL.createObjectURL(blob)
        const audio = new Audio(url)
        previewAudio.current = audio
        const stopFace = () => {
          URL.revokeObjectURL(url)
          if (gen === previewGen.current && kind === 'orb') orbPreview.play('idle')
        }
        audio.onended = stopFace
        audio.onerror = stopFace
        if (kind === 'orb') orbPreview.play('talking')
        void audio.play().catch(stopFace)
      })
      .catch(() => {
        if (gen !== previewGen.current) return
        if (kind === 'orb') orbPreview.play('idle')
        toast.error(t('workforce.agents.identityVoicePreviewFailed'))
      })
  }

  // Hydrate only when the dialog opens. Re-running on every prop tick (new
  // array refs for voices/languages, live agent reload) wiped in-progress typing.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (!open) {
      wasOpen.current = false
      return
    }
    if (wasOpen.current) return
    wasOpen.current = true
    setName(agentName)
    setJobTitle(agentJobTitle ?? '')
    setDescription(agentDescription ?? '')
    setKind(editorKind(avatarKind))
    setColor(resolveAgentAvatarColor(avatarColor))
    setShape(resolveAgentAvatarShape(avatarShape))
    setVoice(callVoice || callVoices?.[0]?.id || '')
    setSpeed(callSpeed ?? 1)
    setLanguage(callLanguage || callLanguages?.[0] || 'nl')
    setEditingName(false)
    setEditingJobTitle(false)
    setEditingDescription(false)
    setError(null)
  }, [
    open,
    agentName,
    agentJobTitle,
    agentDescription,
    avatarKind,
    avatarColor,
    avatarShape,
    callVoice,
    callSpeed,
    callLanguage,
    callVoices,
    callLanguages,
  ])

  const save = async () => {
    if (!token || busy) return
    const trimmed = name.trim()
    if (!trimmed) {
      setError(t('workforce.agents.nameRequired'))
      setEditingName(true)
      return
    }
    const trimmedTitle = jobTitle.trim()
    if (!trimmedTitle) {
      setError(t('workforce.agents.identityJobTitleRequired'))
      setEditingJobTitle(true)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await bokitoUpdateAgent(token, agentId, {
        name: trimmed,
        job_title: trimmedTitle.slice(0, MAX_JOB_TITLE),
        description: description.trim(),
        avatar_kind: kind,
        avatar_icon: null,
        avatar_color: kind === 'orb' ? color : DEFAULT_AGENT_AVATAR_COLOR,
        avatar_shape: kind === 'orb' ? shape : null,
        avatar_image_url: null,
        ...(showVoice
          ? { call_voice: voice, call_speed: speed, call_language: language }
          : {}),
      })
      void reloadAgentsCache().catch(() => {})
      toast.success(t('workforce.agents.identitySaved'))
      onOpenChange(false)
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('workforce.agents.identitySaveError'))
    } finally {
      setBusy(false)
    }
  }

  const previewAccent = agentProfileAccentColor(kind === 'orb' ? color : DEFAULT_AGENT_AVATAR_COLOR)
  const jobTitleTrimmed = jobTitle.trim()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85dvh] max-w-lg flex-col overflow-hidden">
        <DialogTitle className="sr-only">{t('workforce.agents.identityDialogTitle')}</DialogTitle>

        <div className="flex shrink-0 flex-col items-center gap-1 pt-1 pb-3">
          <div className="relative" style={{ width: PREVIEW_SIZE, height: PREVIEW_SIZE }}>
            <AgentGlow color={previewAccent} />
            <AiAvatar
              name={name.trim() || agentName}
              seed={agentId}
              size={PREVIEW_SIZE}
              kind={kind}
              icon={null}
              color={kind === 'orb' ? color : null}
              shape={kind === 'orb' ? shape : null}
              imageUrl={null}
              mode="live"
              className="relative z-[1]"
              motion={kind === 'orb' ? orbPreview.motion : undefined}
              pulseId={kind === 'orb' ? orbPreview.pulseId : undefined}
              spawnKey={kind === 'orb' ? orbPreview.spawnKey : undefined}
              baseMotion="idle"
            />
          </div>

          <div className="mt-3 flex w-full min-w-0 flex-col items-center">
            <Tip label={t('workforce.agents.editIdentity')}>
              <NameEdit
                value={name}
                canEdit
                editing={editingName}
                disabled={busy}
                invalid={editingName && !name.trim()}
                heading="h2"
                size="xl"
                label={t('workforce.agents.instructionsName')}
                onStart={() => {
                  nameAtEditStart.current = name
                  setEditingName(true)
                }}
                onChange={setName}
                onCommit={() => setEditingName(false)}
                onCancel={() => {
                  setName(nameAtEditStart.current)
                  setEditingName(false)
                }}
              />
            </Tip>

            {editingJobTitle || jobTitleTrimmed ? (
              <div className="mt-1" style={{ color: previewAccent }}>
                <Tip label={t('workforce.agents.identityJobTitle')}>
                  <NameEdit
                    value={editingJobTitle ? jobTitle : jobTitleTrimmed}
                    canEdit
                    editing={editingJobTitle}
                    disabled={busy}
                    invalid={editingJobTitle && !jobTitle.trim()}
                    heading="span"
                    size="lg"
                    label={t('workforce.agents.identityJobTitle')}
                    className="font-medium text-current"
                    onStart={() => {
                      jobAtEditStart.current = jobTitle
                      setEditingJobTitle(true)
                    }}
                    onChange={(next) => setJobTitle(next.slice(0, MAX_JOB_TITLE))}
                    onCommit={() => setEditingJobTitle(false)}
                    onCancel={() => {
                      setJobTitle(jobAtEditStart.current)
                      setEditingJobTitle(false)
                    }}
                  />
                </Tip>
              </div>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  jobAtEditStart.current = ''
                  setEditingJobTitle(true)
                }}
                className="mt-1.5 text-sm text-text-muted transition-colors hover:text-text-secondary disabled:opacity-50"
              >
                {t('workforce.agents.profileAddJobTitle')}
              </button>
            )}

            <div className="mt-2 flex w-full justify-center">
              <BlurbEdit
                value={description}
                canEdit
                editing={editingDescription}
                disabled={busy}
                label={t('workforce.agents.identityDescription')}
                emptyLabel={t('workforce.agents.profileAddDescription')}
                placeholder={t('workforce.agents.identityDescriptionPlaceholder')}
                maxLength={MAX_DESCRIPTION}
                onStart={() => {
                  descriptionAtEditStart.current = description
                  setEditingDescription(true)
                }}
                onChange={setDescription}
                onCommit={() => setEditingDescription(false)}
                onCancel={() => {
                  setDescription(descriptionAtEditStart.current)
                  setEditingDescription(false)
                }}
              />
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain pr-1">
          <AgentVisualEditor
            kind={kind}
            color={color}
            shape={shape}
            busy={busy}
            preview={orbPreview}
            showMotion={showMotion}
            onKindChange={setKind}
            onColorChange={setColor}
            onShapeChange={(next) => setShape(resolveAgentAvatarShape(next))}
          />

          {showVoice ? (
            <div className="space-y-2">
              <p className="text-xs text-text-muted">{t('workforce.agents.identityVoiceHint')}</p>
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-text-secondary">{tCall('agentCall.voice')}</p>
                  <Select
                    value={voice}
                    onValueChange={(value) => {
                      setVoice(value)
                      hearVoice({ voice: value })
                    }}
                    disabled={busy}
                  >
                    <SelectTrigger className="h-9 w-full text-sm" aria-label={tCall('agentCall.voice')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-64 overflow-y-auto">
                      {(callVoices ?? []).map((row) => (
                        <SelectItem key={row.id} value={row.id}>
                          {row.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-text-secondary">{tCall('agentCall.speed')}</p>
                  <Select
                    value={String(speed)}
                    onValueChange={(value) => {
                      const next = Number(value)
                      setSpeed(next)
                      hearVoice({ speed: next })
                    }}
                    disabled={busy}
                  >
                    <SelectTrigger className="h-9 w-full text-sm" aria-label={tCall('agentCall.speed')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(callSpeeds ?? []).map((row) => (
                        <SelectItem key={row} value={String(row)}>
                          {speedLabel(row)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-text-secondary">{tCall('agentCall.language')}</p>
                  <Select
                    value={language}
                    onValueChange={(value) => {
                      setLanguage(value)
                      hearVoice({ language: value })
                    }}
                    disabled={busy}
                  >
                    <SelectTrigger className="h-9 w-full text-sm" aria-label={tCall('agentCall.language')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(callLanguages ?? []).map((code) => (
                        <SelectItem key={code} value={code}>
                          {tCall(`agentCall.languageName.${code}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          ) : null}

          {error ? <p className="text-xs text-status-error">{error}</p> : null}
        </div>

        <DialogFooter className="shrink-0">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            {tc('actions.cancel')}
          </Button>
          <Button type="button" onClick={() => void save()} disabled={busy}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
            {tc('actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
