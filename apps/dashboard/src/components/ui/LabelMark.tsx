import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LabelColor } from '../../lib/signals-api'
import { cn } from '../../lib/utils'
import { Button } from './button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog'
import { filterPlatformIcons, platformIcon } from '../../lib/platform-icons'
import {
  FLOW_LABEL_COLOR,
  FLOW_LABEL_ICON,
  LABEL_MARK_COLORS,
  LABEL_MARK_INK,
  labelMarkInk,
  type LabelMarkColor,
} from './label-marks'
import { TagPill } from './TagPill'

function coerceFlowColor(color: LabelColor): LabelMarkColor {
  return (LABEL_MARK_COLORS as readonly string[]).includes(color)
    ? (color as LabelMarkColor)
    : FLOW_LABEL_COLOR
}

function coerceFlowIcon(icon: string): string {
  return icon && platformIcon(icon) ? icon : FLOW_LABEL_ICON
}

/** Color swatches and icon grid shared by the label dialog and new-flow setup. */
export function LabelMarkFields({
  name,
  color,
  icon,
  onColorChange,
  onIconChange,
}: {
  name: string
  color: LabelColor
  icon: string
  onColorChange: (color: LabelColor) => void
  onIconChange: (icon: string) => void
}) {
  const { t } = useTranslation('nav')
  const [query, setQuery] = useState('')
  const markColor = coerceFlowColor(color)
  const markIcon = coerceFlowIcon(icon)

  useEffect(() => {
    setQuery('')
  }, [name])

  const iconIds = useMemo(() => filterPlatformIcons(query, markIcon), [query, markIcon])

  return (
    <div className="space-y-3">
      <TagPill names={name} tone="action" size="md" color={markColor} icon={markIcon} />
      <div className="flex flex-wrap gap-1.5">
        {LABEL_MARK_COLORS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={markColor === value}
            aria-label={t(`workstreamsPage.mark.color.${value}`, { defaultValue: COLOR_LABEL[value] })}
            onClick={() => onColorChange(value)}
            className={cn(
              'h-7 w-7 rounded-full ring-1 ring-inset',
              markColor === value ? 'ring-text-heading' : 'ring-transparent',
            )}
            style={{ backgroundColor: LABEL_MARK_INK[value].ink }}
          />
        ))}
      </div>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t('workstreamsPage.mark.search', {
          defaultValue: 'Search icons (Lucide)',
        })}
        aria-label={t('workstreamsPage.mark.search', {
          defaultValue: 'Search icons (Lucide)',
        })}
        className="h-8 w-full rounded-md border border-border bg-bg-input/60 px-2 text-sm text-text-heading outline-none focus:ring-1 focus:ring-border"
      />
      <div className="grid max-h-[min(50vh,24rem)] grid-cols-8 gap-1 overflow-auto">
        {iconIds.map((id) => {
          const Icon = platformIcon(id)
          if (!Icon) return null
          const selected = markIcon === id
          const ink = labelMarkInk(markColor)
          return (
            <button
              key={id}
              type="button"
              aria-pressed={selected}
              aria-label={id}
              title={id}
              onClick={() => onIconChange(selected ? FLOW_LABEL_ICON : id)}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-md',
                selected ? 'ring-1 ring-text-heading' : 'hover:bg-bg-hover',
              )}
              style={ink ? { color: ink.ink, backgroundColor: ink.wash } : undefined}
            >
              <Icon size={15} aria-hidden />
            </button>
          )
        })}
      </div>
      {!query.trim() ? (
        <p className="text-2xs text-text-muted">
          {t('workstreamsPage.mark.searchHint', {
            defaultValue: 'Popular icons first, then the full Lucide set. Type to filter.',
          })}
        </p>
      ) : null}
    </div>
  )
}

const COLOR_LABEL: Record<LabelMarkColor, string> = {
  rose: 'Red',
  teal: 'Teal',
  violet: 'Purple',
  orange: 'Orange',
  emerald: 'Green',
  pink: 'Pink',
  sky: 'Blue',
}

export function LabelMarkDialog({
  open,
  onOpenChange,
  name,
  color,
  icon,
  saving,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  name: string
  color: LabelColor
  icon: string
  saving?: boolean
  onSave: (next: { color: LabelColor; icon: string }) => void
}) {
  const { t } = useTranslation('nav')
  const [draftColor, setDraftColor] = useState<LabelColor>(coerceFlowColor(color))
  const [draftIcon, setDraftIcon] = useState(coerceFlowIcon(icon))

  useEffect(() => {
    if (!open) return
    setDraftColor(coerceFlowColor(color))
    setDraftIcon(coerceFlowIcon(icon))
  }, [open, color, icon])

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setDraftColor(coerceFlowColor(color))
          setDraftIcon(coerceFlowIcon(icon))
        }
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('workstreamsPage.mark.title', { defaultValue: 'Label' })}</DialogTitle>
          <DialogDescription>
            {t('workstreamsPage.mark.body', {
              defaultValue: 'Pick a color and an icon. The label stays a pill.',
            })}
          </DialogDescription>
        </DialogHeader>
        <LabelMarkFields
          name={name}
          color={draftColor}
          icon={draftIcon}
          onColorChange={setDraftColor}
          onIconChange={setDraftIcon}
        />
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>
            {t('workstreamsPage.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            type="button"
            onClick={() =>
              onSave({
                color: coerceFlowColor(draftColor),
                icon: coerceFlowIcon(draftIcon),
              })
            }
            disabled={saving}
          >
            {t('workstreamsPage.mark.save', { defaultValue: 'Save' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
