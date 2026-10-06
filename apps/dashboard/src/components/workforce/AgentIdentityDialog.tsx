import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
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
import { bokitoUpdateAgent } from '../../lib/bokito-api'
import {
  AGENT_AVATAR_ICON_KEYS,
  AGENT_AVATAR_ICONS,
  type AgentAvatarKind,
} from '../../lib/agent-avatar'
import { cn } from '../../lib/utils'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  agentId: string
  agentName: string
  agentDescription?: string | null
  avatarKind?: string | null
  avatarIcon?: string | null
  onChanged?: () => void
}

const MAX_DESCRIPTION = 280

function editorKind(value: string | null | undefined): 'initials' | 'icon' {
  const kind = (value ?? '').trim().toLowerCase() as AgentAvatarKind | ''
  return kind === 'icon' ? 'icon' : 'initials'
}

/** Name, short description and optional icon for a company agent (platform AI violet). */
export function AgentIdentityDialog({
  open,
  onOpenChange,
  agentId,
  agentName,
  agentDescription,
  avatarKind,
  avatarIcon,
  onChanged,
}: Props) {
  const { t } = useTranslation('nav')
  const { t: tc } = useTranslation()
  const { token } = useAuth()
  const [name, setName] = useState(agentName)
  const [description, setDescription] = useState(agentDescription ?? '')
  const [kind, setKind] = useState<'initials' | 'icon'>(editorKind(avatarKind))
  const [icon, setIcon] = useState(avatarIcon ?? 'bot')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(agentName)
    setDescription(agentDescription ?? '')
    setKind(editorKind(avatarKind))
    setIcon(avatarIcon ?? 'bot')
    setError(null)
  }, [open, agentName, agentDescription, avatarKind, avatarIcon])

  const save = async () => {
    if (!token || busy) return
    const trimmed = name.trim()
    if (!trimmed) {
      setError(t('workforce.agents.nameRequired'))
      return
    }
    if (kind === 'icon' && !icon) {
      setError(t('workforce.agents.visualIconRequired'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await bokitoUpdateAgent(token, agentId, {
        name: trimmed,
        description: description.trim(),
        avatar_kind: kind,
        avatar_icon: kind === 'icon' ? icon : null,
        avatar_image_url: null,
      })
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('workforce.agents.identityDialogTitle')}</DialogTitle>
          <DialogDescription>{t('workforce.agents.identityDialogBody')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <AiAvatar
              name={name.trim() || agentName}
              seed={agentId}
              size={48}
              kind={kind}
              icon={kind === 'icon' ? icon : null}
              imageUrl={null}
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

          <Tabs value={kind} onValueChange={(v) => setKind(v === 'icon' ? 'icon' : 'initials')}>
            <TabsList className="h-9 w-full sm:w-auto">
              <TabsTrigger value="initials" className="flex-1 text-xs sm:flex-none">
                {t('workforce.agents.visualKind.initials')}
              </TabsTrigger>
              <TabsTrigger value="icon" className="flex-1 text-xs sm:flex-none">
                {t('workforce.agents.visualKind.icon')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="initials" className="mt-3">
              <p className="text-sm text-text-muted">{t('workforce.agents.visualInitialsHint')}</p>
            </TabsContent>

            <TabsContent value="icon" className="mt-3 space-y-2">
              <p className="text-xs font-medium text-text-secondary">
                {t('workforce.agents.visualPickIcon')}
              </p>
              <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-8">
                {AGENT_AVATAR_ICON_KEYS.map((key) => {
                  const Icon = AGENT_AVATAR_ICONS[key]
                  const selected = icon === key
                  return (
                    <button
                      key={key}
                      type="button"
                      title={key}
                      aria-label={key}
                      aria-pressed={selected}
                      disabled={busy}
                      onClick={() => setIcon(key)}
                      className={cn(
                        'inline-flex h-9 w-9 items-center justify-center rounded-lg border transition-colors',
                        selected
                          ? 'border-ai/40 bg-ai/10 text-ai-ink'
                          : 'border-border/60 bg-bg-input/40 text-text-secondary hover:border-ai/30 hover:text-text-heading',
                      )}
                    >
                      <Icon size={16} aria-hidden />
                    </button>
                  )
                })}
              </div>
            </TabsContent>
          </Tabs>

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
