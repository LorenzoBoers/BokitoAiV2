import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import { SectionLabel } from '../ui/section-label'
import { BotOrbAvatar } from '../ui/BotOrbAvatar'
import { useWorkspace } from '../../context/WorkspaceContext'
import {
  BOT_ORB_SHAPE_KEYS,
  CODING_AGENT_SHAPE_KEYS,
  botOrbMoreColors,
  botOrbShapeHasFixedColors,
  DEFAULT_BOT_ORB_COLOR,
} from '../../lib/bot-orb-shapes'
import { useAuth } from '../../context/AuthContext'
import type { BotOrbMotion } from '../../lib/bot-orb-motion'
import type { useLocalOrbPreview } from '../../hooks/useBotOrbPulse'
import { resolveBrandSeed } from '../../lib/tenant-branding'
import { cn } from '../../lib/utils'

type PreviewMotionId = BotOrbMotion | 'spawn'
type OrbPreview = ReturnType<typeof useLocalOrbPreview>

const PREVIEW_MOTION_IDS: PreviewMotionId[] = [
  'idle',
  'listening',
  'thinking',
  'working',
  'searching',
  'writing',
  'sending',
  'sleeping',
  'spawn',
  'yes',
  'no',
  'alert',
  'jump',
  'done',
  'leave',
]
const PREVIEW_MOTIONS = PREVIEW_MOTION_IDS.map((id) => ({ id, labelKey: `workforce.agents.orbPreview.${id}` }))

const QUICK_SHAPES = ['blob', 'square', 'triangle'] as const

type Props = {
  kind: 'initials' | 'orb'
  color: string
  shape: string
  busy?: boolean
  preview?: OrbPreview
  compactShapes?: boolean
  showMotion?: boolean
  onKindChange: (kind: 'initials' | 'orb') => void
  onColorChange: (color: string) => void
  onShapeChange: (shape: string) => void
}

/** Shape, color and motion preview shared by the agent identity dialog and first-run wizard. */
export function AgentVisualEditor({
  kind,
  color,
  shape,
  busy,
  preview,
  compactShapes = false,
  showMotion = true,
  onKindChange,
  onColorChange,
  onShapeChange,
}: Props) {
  const { t } = useTranslation('nav')
  const { user } = useAuth()
  const { currentWorkspace } = useWorkspace()
  const [moreColorsOpen, setMoreColorsOpen] = useState(false)
  const [moreShapesOpen, setMoreShapesOpen] = useState(false)
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
    if (!quickColors.some((row) => row.value === color)) setMoreColorsOpen(true)
  }, [color, quickColors])
  useEffect(() => {
    if (compactShapes && !(QUICK_SHAPES as readonly string[]).includes(shape)) setMoreShapesOpen(true)
  }, [compactShapes, shape])
  const shapeKeys = useMemo(() => {
    const coding = new Set<string>(CODING_AGENT_SHAPE_KEYS)
    const visible = user?.codingAgentIntegrationsEnabled
      ? BOT_ORB_SHAPE_KEYS
      : BOT_ORB_SHAPE_KEYS.filter((key) => !coding.has(key))
    return compactShapes ? visible.filter((key) => !(QUICK_SHAPES as readonly string[]).includes(key)) : visible
  }, [compactShapes, user?.codingAgentIntegrationsEnabled])

  return (
    <Tabs value={kind} onValueChange={(v) => onKindChange(v === 'initials' ? 'initials' : 'orb')}>
      <TabsList className={cn('h-9 w-full sm:w-auto', compactShapes && 'mx-auto')}>
        <TabsTrigger value="orb" className="flex-1 text-xs sm:flex-none">
          {t('workforce.agents.visualKind.orb')}
        </TabsTrigger>
        <TabsTrigger value="initials" className="flex-1 text-xs sm:flex-none">
          {t('workforce.agents.visualKind.initials')}
        </TabsTrigger>
      </TabsList>

      <TabsContent value="orb" className="mt-3 space-y-4">
        <div className="space-y-2">
          <p className={cn('text-xs font-medium text-text-secondary', compactShapes && 'text-center')}>{t('workforce.agents.visualPickShape')}</p>
          {compactShapes ? (
            <div className="flex justify-center gap-1.5" role="listbox" aria-label={t('workforce.agents.visualPickShape')}>
              {QUICK_SHAPES.map((key) => (
                <ShapeButton
                  key={key}
                  shapeKey={key}
                  color={color}
                  selected={shape === key}
                  label={t(`workforce.agents.visualShapes.${key}`, { defaultValue: key })}
                  disabled={busy}
                  onPick={onShapeChange}
                />
              ))}
            </div>
          ) : null}
          {compactShapes ? (
            <SectionLabel
              title={t('workforce.agents.visualMoreShapes')}
              open={moreShapesOpen}
              onOpenChange={setMoreShapesOpen}
              className="pt-1"
              contentClassName="pt-1.5"
            >
              <ShapeGrid keys={shapeKeys} color={color} shape={shape} busy={busy} onShapeChange={onShapeChange} />
            </SectionLabel>
          ) : (
            <ShapeGrid keys={shapeKeys} color={color} shape={shape} busy={busy} onShapeChange={onShapeChange} />
          )}
        </div>

        {botOrbShapeHasFixedColors(shape) ? (
          <p className={cn('text-xs text-text-muted', compactShapes && 'text-center')}>
            {t('workforce.agents.visualFixedColors')}
          </p>
        ) : (
        <div className="space-y-2">
          <p className={cn('text-xs font-medium text-text-secondary', compactShapes && 'text-center')}>{t('workforce.agents.visualPickColor')}</p>
          <div className={cn('flex flex-wrap gap-1.5', compactShapes && 'justify-center')}>
            {quickColors.map((swatch) => (
              <ColorSwatch
                key={swatch.id}
                value={swatch.value}
                label={t(`workforce.agents.visualColors.${swatch.id}`, { defaultValue: swatch.id })}
                selected={color === swatch.value}
                disabled={busy}
                onPick={onColorChange}
              />
            ))}
          </div>
          <SectionLabel
            title={t('workforce.agents.visualMoreColors')}
            open={moreColorsOpen}
            onOpenChange={setMoreColorsOpen}
            className="pt-1"
            contentClassName="pt-1.5"
          >
            <div className="flex flex-wrap gap-1.5">
              {moreColors.map((swatch) => (
                <ColorSwatch
                  key={swatch.id}
                  value={swatch.value}
                  label={t(`workforce.agents.visualColors.${swatch.id}`, { defaultValue: swatch.id })}
                  selected={color === swatch.value}
                  disabled={busy}
                  onPick={onColorChange}
                />
              ))}
            </div>
          </SectionLabel>
        </div>
        )}

        {showMotion && preview ? (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-text-secondary">{t('workforce.agents.orbPreview.label')}</p>
            <div className="flex flex-wrap gap-1">
              {PREVIEW_MOTIONS.map((row) => {
                const active =
                  row.id === 'spawn' ? preview.previewingSpawn : !preview.previewingSpawn && preview.motion === row.id
                return (
                  <button
                    key={row.id}
                    type="button"
                    disabled={busy}
                    onClick={() => (row.id === 'spawn' ? preview.playSpawn() : preview.play(row.id))}
                    className={cn(
                      'rounded-md px-2 py-1 text-2xs font-medium transition-colors',
                      active ? 'bg-ai/15 text-ai-ink' : 'bg-bg-elevated text-text-muted hover:text-text-heading',
                    )}
                  >
                    {t(row.labelKey)}
                  </button>
                )
              })}
            </div>
            <p className="text-2xs text-text-muted">{t('workforce.agents.visualOrbHint')}</p>
          </div>
        ) : null}
      </TabsContent>

      <TabsContent value="initials" className="mt-3">
        <p className="text-sm text-text-muted">{t('workforce.agents.visualInitialsHint')}</p>
      </TabsContent>
    </Tabs>
  )
}

function ShapeGrid({
  keys,
  color,
  shape,
  busy,
  onShapeChange,
}: {
  keys: readonly string[]
  color: string
  shape: string
  busy?: boolean
  onShapeChange: (shape: string) => void
}) {
  const { t } = useTranslation('nav')
  return (
    <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-8" role="listbox" aria-label={t('workforce.agents.visualPickShape')}>
      {keys.map((key) => (
        <ShapeButton
          key={key}
          shapeKey={key}
          color={color}
          selected={shape === key}
          label={t(`workforce.agents.visualShapes.${key}`, { defaultValue: key })}
          disabled={busy}
          onPick={onShapeChange}
        />
      ))}
    </div>
  )
}

function ShapeButton({
  shapeKey,
  color,
  selected,
  label,
  disabled,
  onPick,
}: {
  shapeKey: string
  color: string
  selected: boolean
  label: string
  disabled?: boolean
  onPick: (shape: string) => void
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-selected={selected}
      role="option"
      disabled={disabled}
      onClick={() => onPick(shapeKey)}
      className={cn(
        'inline-flex h-11 w-11 items-center justify-center rounded-lg border transition-colors',
        selected ? 'border-ai/50 bg-ai/10' : 'border-border/60 bg-bg-input/30 hover:border-ai/30',
      )}
    >
      <BotOrbAvatar color={color} shape={shapeKey} size={32} mode="static" decorative />
    </button>
  )
}

function ColorSwatch({
  value,
  label,
  selected,
  disabled,
  onPick,
}: {
  value: string
  label: string
  selected: boolean
  disabled?: boolean
  onPick: (value: string) => void
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={selected}
      disabled={disabled}
      onClick={() => onPick(value)}
      className={cn(
        'h-8 w-8 rounded-full border-2 transition-shadow',
        selected
          ? 'border-text-heading shadow-[0_0_0_2px_rgb(var(--color-bg-surface)),0_0_0_4px_rgb(var(--color-ai)/0.45)]'
          : 'border-border/50 hover:border-border',
      )}
      style={{ backgroundColor: value }}
    />
  )
}
