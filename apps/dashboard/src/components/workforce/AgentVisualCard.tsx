import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ImagePlus, Loader2, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { Card } from '../ui/card'
import { Button } from '../ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import { AiAvatar } from '../ui/AiAvatar'
import { useAuth } from '../../context/AuthContext'
import { bokitoUpdateAgent } from '../../lib/bokito-api'
import { uploadAttachment } from '../../lib/uploads-api'
import {
  AGENT_AVATAR_COLORS,
  AGENT_AVATAR_ICON_KEYS,
  AGENT_AVATAR_ICONS,
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
  if (kind === 'icon' || kind === 'image') return kind
  return 'initials'
}

/** Visual identity card: initials, Lucide icon + color, or uploaded photo. */
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
  const fileRef = useRef<HTMLInputElement>(null)
  const [uncontrolledEditing, setUncontrolledEditing] = useState(false)
  const editing = editingProp ?? uncontrolledEditing
  const setEditing = (next: boolean) => {
    onEditingChange?.(next)
    if (editingProp === undefined) setUncontrolledEditing(next)
  }
  const [kind, setKind] = useState<AgentAvatarKind>(normalizeKind(avatarKind))
  const [icon, setIcon] = useState(avatarIcon ?? 'bot')
  const [color, setColor] = useState(avatarColor ?? AGENT_AVATAR_COLORS[0])
  const [imageUrl, setImageUrl] = useState(avatarImageUrl ?? '')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!editing) {
      setKind(normalizeKind(avatarKind))
      setIcon(avatarIcon ?? 'bot')
      setColor(avatarColor ?? AGENT_AVATAR_COLORS[0])
      setImageUrl(avatarImageUrl ?? '')
      setError(null)
    }
  }, [avatarKind, avatarIcon, avatarColor, avatarImageUrl, editing])

  const previewColor = color

  if (hideChrome && !editing) return null

  const save = async () => {
    if (!token || busy) return
    if (kind === 'image' && !imageUrl.trim()) {
      setError(t('workforce.agents.visualImageRequired'))
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
        avatar_kind: kind,
        avatar_icon: kind === 'icon' ? icon : null,
        avatar_color: color,
        avatar_image_url: kind === 'image' ? imageUrl.trim() : null,
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

  const onPickImage = async (file: File | null) => {
    if (!file || !token) return
    setUploading(true)
    setError(null)
    try {
      const uploaded = await uploadAttachment(token, file)
      setImageUrl(uploaded.url)
      setKind('image')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('workforce.agents.visualUploadError'))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

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
          color={editing ? previewColor : avatarColor}
          imageUrl={editing ? (kind === 'image' ? imageUrl : null) : avatarImageUrl}
        />
        <p className="text-sm text-text-secondary">
          {t(`workforce.agents.visualKind.${normalizeKind(editing ? kind : avatarKind)}`)}
        </p>
      </div>

      {editing ? (
        <div className="mt-3 space-y-3">
          <Tabs value={kind} onValueChange={(v) => setKind(normalizeKind(v))}>
            <TabsList className="h-9 w-full sm:w-auto">
              <TabsTrigger value="initials" className="flex-1 text-xs sm:flex-none">
                {t('workforce.agents.visualKind.initials')}
              </TabsTrigger>
              <TabsTrigger value="icon" className="flex-1 text-xs sm:flex-none">
                {t('workforce.agents.visualKind.icon')}
              </TabsTrigger>
              <TabsTrigger value="image" className="flex-1 text-xs sm:flex-none">
                {t('workforce.agents.visualKind.image')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="initials" className="mt-3 space-y-3">
              <p className="text-sm text-text-muted">{t('workforce.agents.visualInitialsHint')}</p>
              <div>
                <p className="mb-2 text-xs font-medium text-text-secondary">
                  {t('workforce.agents.visualPickColor')}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {AGENT_AVATAR_COLORS.map((hex) => {
                    const selected = color.toLowerCase() === hex
                    return (
                      <button
                        key={hex}
                        type="button"
                        title={hex}
                        aria-label={hex}
                        aria-pressed={selected}
                        onClick={() => setColor(hex)}
                        className={cn(
                          'h-7 w-7 rounded-full border-2 transition-transform',
                          selected ? 'scale-110 border-text-heading' : 'border-transparent',
                        )}
                        style={{ backgroundColor: hex }}
                      />
                    )
                  })}
                </div>
              </div>
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
                            ? 'border-accent bg-accent/10 text-accent'
                            : 'border-border/60 bg-bg-input/40 text-text-secondary hover:border-accent/40 hover:text-text-heading',
                        )}
                      >
                        <Icon size={16} aria-hidden />
                      </button>
                    )
                  })}
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs font-medium text-text-secondary">
                  {t('workforce.agents.visualPickColor')}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {AGENT_AVATAR_COLORS.map((hex) => {
                    const selected = color.toLowerCase() === hex
                    return (
                      <button
                        key={hex}
                        type="button"
                        title={hex}
                        aria-label={hex}
                        aria-pressed={selected}
                        onClick={() => setColor(hex)}
                        className={cn(
                          'h-7 w-7 rounded-full border-2 transition-transform',
                          selected ? 'scale-110 border-text-heading' : 'border-transparent',
                        )}
                        style={{ backgroundColor: hex }}
                      />
                    )
                  })}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="image" className="mt-3 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void onPickImage(e.target.files?.[0] ?? null)}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={uploading || !token}
                  onClick={() => fileRef.current?.click()}
                >
                  {uploading ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <ImagePlus size={14} className="mr-1.5" aria-hidden />
                  )}
                  {t('workforce.agents.visualUpload')}
                </Button>
                {imageUrl ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setImageUrl('')}
                    disabled={uploading}
                  >
                    {t('workforce.agents.visualClearImage')}
                  </Button>
                ) : null}
              </div>
              <p className="text-sm text-text-muted">{t('workforce.agents.visualImageHint')}</p>
              <div>
                <p className="mb-2 text-xs font-medium text-text-secondary">
                  {t('workforce.agents.visualPickColor')}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {AGENT_AVATAR_COLORS.map((hex) => {
                    const selected = color.toLowerCase() === hex
                    return (
                      <button
                        key={hex}
                        type="button"
                        title={hex}
                        aria-label={hex}
                        aria-pressed={selected}
                        onClick={() => setColor(hex)}
                        className={cn(
                          'h-7 w-7 rounded-full border-2 transition-transform',
                          selected ? 'scale-110 border-text-heading' : 'border-transparent',
                        )}
                        style={{ backgroundColor: hex }}
                      />
                    )
                  })}
                </div>
              </div>
            </TabsContent>
          </Tabs>

          {error ? <p className="text-[12px] text-status-error">{error}</p> : null}
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" onClick={() => void save()} disabled={busy || uploading}>
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
              {tc('actions.save')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setEditing(false)}
              disabled={busy || uploading}
            >
              {tc('actions.cancel')}
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  )
}
