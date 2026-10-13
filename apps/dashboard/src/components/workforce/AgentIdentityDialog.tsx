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
import { BotOrbAvatar } from '../ui/BotOrbAvatar'
import { Textarea } from '../ui/textarea'
import { useAuth } from '../../context/AuthContext'
import { bokitoUpdateAgent } from '../../lib/bokito-api'
import {
  DEFAULT_AGENT_AVATAR_COLOR,
  resolveAgentAvatarColor,
  resolveAgentAvatarShape,
  type AgentAvatarKind,
} from '../../lib/agent-avatar'
import { BOT_ORB_COLORS, BOT_ORB_SHAPE_KEYS } from '../../lib/bot-orb-shapes'
import { cn } from '../../lib/utils'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  agentId: string
  agentName: string
  agentDescription?: string | null
  avatarKind?: string | null
  avatarIcon?: string | null
  avatarColor?: string | null
  avatarShape?: string | null
  onChanged?: () => void
}

const MAX_DESCRIPTION = 280

function editorKind(value: string | null | undefined): 'initials' | 'orb' {
  const kind = (value ?? '').trim().toLowerCase() as AgentAvatarKind | ''
  return kind === 'orb' ? 'orb' : 'initials'
}

/** Name, short description and bot mark (shape + color) or initials. */
export function AgentIdentityDialog({
  open,
  onOpenChange,
  agentId,
  agentName,
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
  const [description, setDescription] = useState(agentDescription ?? '')
  const [kind, setKind] = useState<'initials' | 'orb'>(editorKind(avatarKind))
  const [color, setColor] = useState(resolveAgentAvatarColor(avatarColor))
  const [shape, setShape] = useState(resolveAgentAvatarShape(avatarShape))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(agentName)
    setDescription(agentDescription ?? '')
    setKind(editorKind(avatarKind))
    setColor(resolveAgentAvatarColor(avatarColor))
    setShape(resolveAgentAvatarShape(avatarShape))
    setError(null)
  }, [open, agentName, agentDescription, avatarKind, avatarColor, avatarShape])

  const save = async () => {
    if (!token || busy) return
    const trimmed = name.trim()
    if (!trimmed) {
      setError(t('workforce.agents.nameRequired'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await bokitoUpdateAgent(token, agentId, {
        name: trimmed,
        description: description.trim(),
        avatar_kind: kind,
        avatar_icon: null,
        avatar_color: kind === 'orb' ? color : DEFAULT_AGENT_AVATAR_COLOR,
        avatar_shape: kind === 'orb' ? shape : null,
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

          <Tabs value={kind} onValueChange={(v) => setKind(v === 'orb' ? 'orb' : 'initials')}>
            <TabsList className="h-9 w-full sm:w-auto">
              <TabsTrigger value="initials" className="flex-1 text-xs sm:flex-none">
                {t('workforce.agents.visualKind.initials')}
              </TabsTrigger>
              <TabsTrigger value="orb" className="flex-1 text-xs sm:flex-none">
                {t('workforce.agents.visualKind.orb')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="initials" className="mt-3">
              <p className="text-sm text-text-muted">{t('workforce.agents.visualInitialsHint')}</p>
            </TabsContent>

            <TabsContent value="orb" className="mt-3 space-y-4">
              <div className="space-y-2">
                <p className="text-xs font-medium text-text-secondary">
                  {t('workforce.agents.visualPickShape')}
                </p>
                <div
                  className="grid grid-cols-5 gap-1.5 sm:grid-cols-8"
                  role="listbox"
                  aria-label={t('workforce.agents.visualPickShape')}
                >
                  {BOT_ORB_SHAPE_KEYS.map((key) => {
                    const selected = shape === key
                    const label = t(`workforce.agents.visualShapes.${key}`, { defaultValue: key })
                    return (
                      <button
                        key={key}
                        type="button"
                        title={label}
                        aria-label={label}
                        aria-selected={selected}
                        role="option"
                        disabled={busy}
                        onClick={() => setShape(key)}
                        className={cn(
                          'inline-flex h-11 w-full items-center justify-center rounded-lg border transition-colors',
                          selected
                            ? 'border-ai/50 bg-ai/10'
                            : 'border-border/60 bg-bg-input/30 hover:border-ai/30',
                        )}
                      >
                        <BotOrbAvatar color={color} shape={key} size={28} paused decorative />
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-text-secondary">
                  {t('workforce.agents.visualPickColor')}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {BOT_ORB_COLORS.map((swatch) => {
                    const selected = color === swatch.value
                    const label = t(`workforce.agents.visualColors.${swatch.id}`, {
                      defaultValue: swatch.id,
                    })
                    return (
                      <button
                        key={swatch.id}
                        type="button"
                        title={label}
                        aria-label={label}
                        aria-pressed={selected}
                        disabled={busy}
                        onClick={() => setColor(swatch.value)}
                        className={cn(
                          'h-8 w-8 rounded-full border-2 transition-shadow',
                          selected
                            ? 'border-text-heading shadow-[0_0_0_2px_rgb(var(--color-bg-surface)),0_0_0_4px_rgb(var(--color-ai)/0.45)]'
                            : 'border-border/50 hover:border-border',
                        )}
                        style={{ backgroundColor: swatch.value }}
                      />
                    )
                  })}
                </div>
              </div>
              <p className="text-2xs text-text-muted">{t('workforce.agents.visualOrbHint')}</p>
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
