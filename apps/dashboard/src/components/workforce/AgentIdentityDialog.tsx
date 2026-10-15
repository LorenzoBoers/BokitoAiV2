import { useEffect, useMemo, useState } from 'react'
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
import { SectionLabel } from '../ui/section-label'
import { AiAvatar } from '../ui/AiAvatar'
import { BotOrbAvatar } from '../ui/BotOrbAvatar'
import { Textarea } from '../ui/textarea'
import { useAuth } from '../../context/AuthContext'
import { useWorkspace } from '../../context/WorkspaceContext'
import { reloadAgentsCache } from '../../hooks/useAgents'
import { bokitoUpdateAgent } from '../../lib/bokito-api'
import {
  DEFAULT_AGENT_AVATAR_COLOR,
  resolveAgentAvatarColor,
  resolveAgentAvatarShape,
  type AgentAvatarKind,
} from '../../lib/agent-avatar'
import {
  BOT_ORB_SHAPE_KEYS,
  botOrbMoreColors,
  DEFAULT_BOT_ORB_COLOR,
} from '../../lib/bot-orb-shapes'
import type { BotOrbMotion } from '../../lib/bot-orb-motion'
import { useLocalOrbPreview } from '../../hooks/useBotOrbPulse'
import { resolveBrandSeed } from '../../lib/tenant-branding'
import { cn } from '../../lib/utils'

const PREVIEW_MOTIONS: { id: BotOrbMotion; labelKey: string }[] = [
  { id: 'idle', labelKey: 'workforce.agents.orbPreview.idle' },
  { id: 'thinking', labelKey: 'workforce.agents.orbPreview.thinking' },
  { id: 'typing', labelKey: 'workforce.agents.orbPreview.typing' },
  { id: 'working', labelKey: 'workforce.agents.orbPreview.working' },
  { id: 'yes', labelKey: 'workforce.agents.orbPreview.yes' },
  { id: 'no', labelKey: 'workforce.agents.orbPreview.no' },
  { id: 'alert', labelKey: 'workforce.agents.orbPreview.alert' },
  { id: 'jump', labelKey: 'workforce.agents.orbPreview.jump' },
]

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
  // Bot (orb) is the product default; initials/icons are the secondary option.
  if (kind === 'initials' || kind === 'icon' || kind === 'image') return 'initials'
  return 'orb'
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
  const { currentWorkspace } = useWorkspace()
  const [name, setName] = useState(agentName)
  const [description, setDescription] = useState(agentDescription ?? '')
  const [kind, setKind] = useState<'initials' | 'orb'>(editorKind(avatarKind))
  const [color, setColor] = useState(resolveAgentAvatarColor(avatarColor))
  const [shape, setShape] = useState(resolveAgentAvatarShape(avatarShape))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [moreColorsOpen, setMoreColorsOpen] = useState(false)
  const orbPreview = useLocalOrbPreview('idle')

  const accentHex = useMemo(
    () => resolveBrandSeed(currentWorkspace?.brand_color).toLowerCase(),
    [currentWorkspace?.brand_color],
  )
  const quickColors = useMemo(
    () =>
      [
        { id: 'violet', value: DEFAULT_BOT_ORB_COLOR },
        { id: 'accent', value: accentHex },
        { id: 'gray', value: '#777777' },
      ] as const,
    [accentHex],
  )
  const moreColors = useMemo(() => botOrbMoreColors(), [])

  useEffect(() => {
    if (!open) return
    setName(agentName)
    setDescription(agentDescription ?? '')
    setKind(editorKind(avatarKind))
    const nextColor = resolveAgentAvatarColor(avatarColor)
    setColor(nextColor)
    setShape(resolveAgentAvatarShape(avatarShape))
    setError(null)
    const inQuick = quickColors.some((row) => row.value === nextColor)
    setMoreColorsOpen(!inQuick)
  }, [open, agentName, agentDescription, avatarKind, avatarColor, avatarShape, quickColors])

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
              motion={kind === 'orb' ? orbPreview.motion : undefined}
              pulseId={kind === 'orb' ? orbPreview.pulseId : undefined}
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

          <Tabs value={kind} onValueChange={(v) => setKind(v === 'initials' ? 'initials' : 'orb')}>
            <TabsList className="h-9 w-full sm:w-auto">
              <TabsTrigger value="orb" className="flex-1 text-xs sm:flex-none">
                {t('workforce.agents.visualKind.orb')}
              </TabsTrigger>
              <TabsTrigger value="initials" className="flex-1 text-xs sm:flex-none">
                {t('workforce.agents.visualKind.initials')}
              </TabsTrigger>
            </TabsList>

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
                  {quickColors.map((swatch) => {
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
                <SectionLabel
                  title={t('workforce.agents.visualMoreColors')}
                  open={moreColorsOpen}
                  onOpenChange={setMoreColorsOpen}
                  className="pt-1"
                  contentClassName="pt-1.5"
                >
                  <div className="flex flex-wrap gap-1.5">
                    {moreColors.map((swatch) => {
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
                </SectionLabel>
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-text-secondary">
                  {t('workforce.agents.orbPreview.label')}
                </p>
                <div className="flex flex-wrap gap-1">
                  {PREVIEW_MOTIONS.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      disabled={busy}
                      onClick={() => orbPreview.play(row.id)}
                      className={cn(
                        'rounded-md px-2 py-1 text-2xs font-medium transition-colors',
                        orbPreview.motion === row.id
                          ? 'bg-ai/15 text-ai-ink'
                          : 'bg-bg-elevated text-text-muted hover:text-text-heading',
                      )}
                    >
                      {t(row.labelKey)}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-2xs text-text-muted">{t('workforce.agents.visualOrbHint')}</p>
            </TabsContent>

            <TabsContent value="initials" className="mt-3">
              <p className="text-sm text-text-muted">{t('workforce.agents.visualInitialsHint')}</p>
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
