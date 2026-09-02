import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { Card } from '../ui/card'
import { Button } from '../ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import { AiAvatar } from '../ui/AiAvatar'
import { useAuth } from '../../context/AuthContext'
import { bokitoUpdateAgent } from '../../lib/bokito-api'
import {
  AGENT_AVATAR_ICON_KEYS,
  AGENT_AVATAR_ICONS,
  DEFAULT_AGENT_AVATAR_COLOR,
  type AgentAvatarKind,
} from '../../lib/agent-avatar'
import { cn } from '../../lib/utils'

type Props = {
  agentId: string
  agentName: string
  avatarKind?: string | null
  avatarIcon?: string | null
  avatarColor?: string | null
  avatarImageUrl?: string | null
  canEdit: boolean
  onChanged?: () => void
  /** Controlled edit mode (e.g. opened from the agent header). */
  editing?: boolean
  onEditingChange?: (editing: boolean) => void
  /** Hide the card title/edit row when the parent owns that chrome. */
  hideChrome?: boolean
}

function normalizeKind(value: string | null | undefined): AgentAvatarKind {
  const kind = (value ?? '').trim().toLowerCase()
  // Image remains readable if already set, but the editor only offers initials/icon.
  if (kind === 'icon') return 'icon'
  if (kind === 'image') return 'image'
  return 'initials'
}

function editorKind(value: string | null | undefined): 'initials' | 'icon' {
  return normalizeKind(value) === 'icon' ? 'icon' : 'initials'
}

/** Visual identity: name initials or optional Lucide icon (platform AI tint, no color picker). */
export function AgentVisualCard({
  agentId,
  agentName,
  avatarKind,
  avatarIcon,
  avatarColor,
  avatarImageUrl,
  canEdit,
  onChanged,
  editing: editingProp,
  onEditingChange,
  hideChrome = false,
}: Props) {
  const { t } = useTranslation('nav')
  const { t: tc } = useTranslation()
  const { token } = useAuth()
  const [uncontrolledEditing, setUncontrolledEditing] = useState(false)
  const editing = editingProp ?? uncontrolledEditing
  const setEditing = (next: boolean) => {
    onEditingChange?.(next)
    if (editingProp === undefined) setUncontrolledEditing(next)
  }
  const [kind, setKind] = useState<'initials' | 'icon'>(editorKind(avatarKind))
  const [icon, setIcon] = useState(avatarIcon ?? 'bot')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!editing) {
      setKind(editorKind(avatarKind))
      setIcon(avatarIcon ?? 'bot')
      setError(null)
    }
  }, [avatarKind, avatarIcon, editing])

  if (hideChrome && !editing) return null

  const save = async () => {
    if (!token || busy) return
    if (kind === 'icon' && !icon) {
      setError(t('workforce.agents.visualIconRequired'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await bokitoUpdateAgent(token, agentId, {
        avatar_kind: kind,
        avatar_icon: kind === 'icon' ? icon : null,
        avatar_color: DEFAULT_AGENT_AVATAR_COLOR,
        avatar_image_url: null,
      })
      toast.success(t('workforce.agents.visualSaved'))
      setEditing(false)
      onChanged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('workforce.agents.visualSaveError'))
    } finally {
      setBusy(false)
    }
  }

  const previewKind = editing ? kind : avatarKind
  const displayKind = normalizeKind(previewKind)

  return (
    <Card className="px-4 py-3" id="agent-visual">
      {!hideChrome ? (
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold text-text-heading">
              {t('workforce.agents.visualTitle')}
            </h3>
            <p className="mt-1 text-sm text-text-muted">{t('workforce.agents.visualBody')}</p>
          </div>
          {canEdit && !editing ? (
            <Button type="button" size="sm" variant="outline" onClick={() => setEditing(true)}>
              <Pencil size={14} className="mr-1.5" aria-hidden />
              {t('workforce.agents.visualEdit')}
            </Button>
          ) : null}
        </div>
      ) : editing ? (
        <div>
          <h3 className="text-base font-semibold text-text-heading">
            {t('workforce.agents.visualTitle')}
          </h3>
          <p className="mt-1 text-sm text-text-muted">{t('workforce.agents.visualBody')}</p>
        </div>
      ) : null}

      <div className={cn('flex items-center gap-3', (!hideChrome || editing) && 'mt-3')}>
        <AiAvatar
          name={agentName}
          seed={agentId}
          size={48}
          kind={editing ? kind : avatarKind}
          icon={editing ? (kind === 'icon' ? icon : null) : avatarIcon}
          color={DEFAULT_AGENT_AVATAR_COLOR}
          imageUrl={editing ? null : avatarImageUrl}
        />
        <p className="text-sm text-text-secondary">
          {t(`workforce.agents.visualKind.${displayKind === 'image' ? 'image' : displayKind}`)}
        </p>
      </div>

      {editing ? (
        <div className="mt-3 space-y-3">
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

            <TabsContent value="icon" className="mt-3 space-y-3">
              <div>
                <p className="mb-2 text-xs font-medium text-text-secondary">
                  {t('workforce.agents.visualPickIcon')}
                </p>
                <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-10">
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
              </div>
            </TabsContent>
          </Tabs>

          {error ? <p className="text-[12px] text-status-error">{error}</p> : null}
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" onClick={() => void save()} disabled={busy}>
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
              {tc('actions.save')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setEditing(false)}
              disabled={busy}
            >
              {tc('actions.cancel')}
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  )
}
