import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { AiAvatar } from '../ui/AiAvatar'
import { Textarea } from '../ui/textarea'
import { useAuth } from '../../context/AuthContext'
import { reloadAgentsCache } from '../../hooks/useAgents'
import { bokitoUpdateAgent } from '../../lib/bokito-api'
import {
  DEFAULT_AGENT_AVATAR_COLOR,
  resolveAgentAvatarColor,
  resolveAgentAvatarShape,
  type AgentAvatarKind,
} from '../../lib/agent-avatar'
import { useLocalOrbPreview } from '../../hooks/useBotOrbPulse'
import { AgentVisualEditor } from './AgentVisualEditor'

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
  onChanged?: () => void
}

const MAX_JOB_TITLE = 32
const MAX_DESCRIPTION = 280

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
  onChanged,
}: Props) {
  const { t } = useTranslation('nav')
  const { t: tc } = useTranslation()
  const { token } = useAuth()
  const [name, setName] = useState(agentName)
  const [jobTitle, setJobTitle] = useState(agentJobTitle ?? '')
  const [description, setDescription] = useState(agentDescription ?? '')
  const [kind, setKind] = useState<'initials' | 'orb'>(editorKind(avatarKind))
  const [color, setColor] = useState(resolveAgentAvatarColor(avatarColor))
  const [shape, setShape] = useState(resolveAgentAvatarShape(avatarShape))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const orbPreview = useLocalOrbPreview('idle')

  useEffect(() => {
    if (!open) return
    setName(agentName)
    setJobTitle(agentJobTitle ?? '')
    setDescription(agentDescription ?? '')
    setKind(editorKind(avatarKind))
    const nextColor = resolveAgentAvatarColor(avatarColor)
    setColor(nextColor)
    setShape(resolveAgentAvatarShape(avatarShape))
    setError(null)
  }, [open, agentName, agentJobTitle, agentDescription, avatarKind, avatarColor, avatarShape])

  const save = async () => {
    if (!token || busy) return
    const trimmed = name.trim()
    if (!trimmed) {
      setError(t('workforce.agents.nameRequired'))
      return
    }
    const trimmedTitle = jobTitle.trim()
    if (!trimmedTitle) {
      setError(t('workforce.agents.identityJobTitleRequired'))
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('workforce.agents.identityDialogTitle')}</DialogTitle>
          <DialogDescription>{t('workforce.agents.identityDialogBody')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <AiAvatar
              name={name.trim() || agentName}
              seed={agentId}
              size={52}
              kind={kind}
              icon={null}
              color={kind === 'orb' ? color : null}
              shape={kind === 'orb' ? shape : null}
              imageUrl={null}
              mode="live"
              motion={kind === 'orb' ? orbPreview.motion : undefined}
              pulseId={kind === 'orb' ? orbPreview.pulseId : undefined}
              spawnKey={kind === 'orb' ? orbPreview.spawnKey : undefined}
              baseMotion="idle"
            />
            <div className="min-w-0 flex-1 space-y-1.5">
              <label className="text-xs font-medium text-text-secondary" htmlFor="agent-identity-name">
                {t('workforce.agents.instructionsName')}
              </label>
              <Input
                id="agent-identity-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void save()
                }}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-text-secondary" htmlFor="agent-identity-job-title">
              {t('workforce.agents.identityJobTitle')}
            </label>
            <Input
              id="agent-identity-job-title"
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value.slice(0, MAX_JOB_TITLE))}
              disabled={busy}
              maxLength={MAX_JOB_TITLE}
              placeholder={t('workforce.agents.identityJobTitlePlaceholder')}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void save()
              }}
            />
            <p className="text-2xs text-text-muted">{t('workforce.agents.identityJobTitleHint')}</p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-text-secondary" htmlFor="agent-identity-description">
              {t('workforce.agents.identityDescription')}
            </label>
            <Textarea
              id="agent-identity-description"
              value={description}
              onChange={(e) => setDescription(e.target.value.slice(0, MAX_DESCRIPTION))}
              disabled={busy}
              rows={3}
              maxLength={MAX_DESCRIPTION}
              placeholder={t('workforce.agents.identityDescriptionPlaceholder')}
            />
            <p className="text-2xs text-text-muted">{t('workforce.agents.identityDescriptionHint')}</p>
          </div>

          <AgentVisualEditor
            kind={kind}
            color={color}
            shape={shape}
            busy={busy}
            preview={orbPreview}
            onKindChange={setKind}
            onColorChange={setColor}
            onShapeChange={setShape}
          />

          {error ? <p className="text-xs text-status-error">{error}</p> : null}
        </div>

        <DialogFooter>
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
