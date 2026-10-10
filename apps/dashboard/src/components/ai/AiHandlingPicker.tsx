import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { ChevronDown, Settings2, ShieldAlert } from 'lucide-react'
import {
  AI_HANDLING_META,
  AI_HANDLING_MODES,
  canSetMode,
  inheritedEffective,
  type AiHandling,
  type AiHandlingMode,
  type AiHandlingScope,
} from '../../lib/ai-handling'
import { cn } from '../../lib/utils'
import { controlChipClass } from '../ui/select'
import { SettingRow } from '../ui/entity-row'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { DefaultBadge } from '../ui/DefaultBadge'
import { OptionCard, OptionCardGrid } from '../ui/option-card'
import { AiHandlingIcon } from './AiHandlingIcon'

export const AI_HANDLING_SETTINGS_PATH = '/settings/communication'

type Props = {
  handling: AiHandling | null
  scope: AiHandlingScope
  onChange: (mode: AiHandlingMode | null) => void | Promise<void>
  /** Owner/admin: may raise to autonomous at any scope. */
  canRaise: boolean
  variant?: 'chip' | 'row' | 'cards'
  /** Row layout. `field` matches channel settings; `inline` matches side panels. */
  density?: 'inline' | 'field'
  saving?: boolean
  disabled?: boolean
  /** Row variant: left-hand title and description. */
  label?: ReactNode
  description?: ReactNode
  /** Extra menu items (take over / hand back) for the chip. */
  extraItems?: ReactNode
  /** Hide the settings link in the menu (already on the settings page). */
  hideSettingsLink?: boolean
  className?: string
  testId?: string
}

function useSourceLine(handling: AiHandling | null, scope: AiHandlingScope): string {
  const { t } = useTranslation('common')
  if (!handling) return ''
  if (handling.own) {
    return handling.untilClose ? t('aiHandling.untilClose') : t('aiHandling.setHere')
  }
  const source = t(`aiHandling.sources.${handling.inheritedSource}`)
  const name = scope === 'conversation' ? handling.sourceLabel : handling.inheritedSourceLabel
  return name ? t('aiHandling.followsNamed', { source, name }) : t('aiHandling.follows', { source })
}

function sourceName(handling: AiHandling, scope: AiHandlingScope): string | undefined {
  const name = scope === 'conversation' ? handling.sourceLabel : handling.inheritedSourceLabel
  return name || undefined
}

function ClampNote({ handling }: { handling: AiHandling }) {
  const { t } = useTranslation('common')
  if (!handling.clampedBy) return null
  return (
    <p className="flex items-start gap-1.5 text-xs leading-snug text-text-muted">
      <ShieldAlert size={12} className="mt-0.5 shrink-0" />
      {t(`aiHandling.clamped.${handling.clampedBy}`, {
        mode: t(`aiHandling.modes.${handling.ceiling}.label`),
      })}
    </p>
  )
}

function ModeMenu({
  handling,
  scope,
  canRaise,
  onChange,
  extraItems,
  hideSettingsLink,
}: Pick<Props, 'handling' | 'scope' | 'canRaise' | 'onChange' | 'extraItems' | 'hideSettingsLink'>) {
  const { t } = useTranslation('common')
  const inherited = handling ? inheritedEffective(handling) : null
  const reason = handling?.own && handling.reason ? t(`aiHandling.reasons.${handling.reason}`, '') : ''
  const untilClose = handling?.own && handling.untilClose ? t('aiHandling.untilClose') : ''
  // Workspace is the top layer: nothing to inherit, so no default badge.
  const defaultMode = scope !== 'workspace' ? inherited : null
  const selectedMode = handling?.own ?? defaultMode
  return (
    <DropdownMenuContent align="end" className="w-72">
      <div className="space-y-1 px-2 py-1.5">
        <p className="text-xs font-medium text-text-heading">{t('aiHandling.title')}</p>
        {reason || untilClose ? (
          <p className="text-xs text-text-secondary">{reason || untilClose}</p>
        ) : null}
        {handling ? <ClampNote handling={handling} /> : null}
      </div>
      <DropdownMenuSeparator />
      {AI_HANDLING_MODES.map((mode) => {
        const isDefault = mode === defaultMode && handling != null
        // Picking the default clears the override instead of pinning the same mode.
        const allowed = isDefault
          ? canSetMode(canRaise, scope, null)
          : canSetMode(canRaise, scope, mode, inherited)
        const selected = selectedMode === mode
        return (
          <DropdownMenuItem
            key={mode}
            disabled={!allowed}
            data-testid={`ai-handling-option-${mode}`}
            data-default={isDefault ? 'true' : undefined}
            className={cn('items-start gap-2.5 py-2', selected && 'bg-accent/15')}
            title={allowed ? undefined : t('aiHandling.needsAdmin')}
            onSelect={() => void onChange(isDefault ? null : mode)}
          >
            <AiHandlingIcon mode={mode} size={14} className="mt-0.5" />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                <span className="text-sm font-medium text-text-heading">
                  {t(`aiHandling.modes.${mode}.label`)}
                </span>
                {isDefault ? (
                  <DefaultBadge title={sourceName(handling, scope)}>
                    {t(`aiHandling.defaultBadge.${handling.inheritedSource}`)}
                  </DefaultBadge>
                ) : null}
              </span>
              <span className="block text-xs leading-snug text-text-muted">
                {t(`aiHandling.modes.${mode}.description`)}
              </span>
            </span>
          </DropdownMenuItem>
        )
      })}
      {extraItems ? (
        <>
          <DropdownMenuSeparator />
          {extraItems}
        </>
      ) : null}
      {hideSettingsLink ? null : (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild className="gap-2 text-xs">
            <Link to={AI_HANDLING_SETTINGS_PATH}>
              <Settings2 size={13} />
              {t('aiHandling.openSettings')}
            </Link>
          </DropdownMenuItem>
        </>
      )}
    </DropdownMenuContent>
  )
}

function Chip({
  handling,
  saving,
  disabled,
  testId,
  className,
  compact = false,
  title,
}: {
  handling: AiHandling | null
  saving?: boolean
  disabled?: boolean
  testId?: string
  className?: string
  compact?: boolean
  title?: string
}) {
  const { t } = useTranslation('common')
  const mode = handling?.effective ?? 'assisted'
  const label = t(`aiHandling.modes.${mode}.label`)
  return (
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        disabled={saving || disabled || !handling}
        aria-label={`${t('aiHandling.title')}: ${label}`}
        title={title || undefined}
        data-testid={testId ?? 'ai-handling-chip'}
        data-mode={mode}
        className={cn(
          controlChipClass,
          handling?.own && AI_HANDLING_META[mode].tone === 'ai' && 'border-ai/30',
          className,
        )}
      >
        <AiHandlingIcon mode={mode} size={12} />
        {compact ? null : <span className="max-w-[9rem] truncate-fade">{label}</span>}
        {handling?.clampedBy ? <ShieldAlert size={11} className="shrink-0 text-text-muted" /> : null}
        <ChevronDown size={11} className="shrink-0 text-text-muted" />
      </button>
    </DropdownMenuTrigger>
  )
}

/**
 * One picker for AI handling at every layer.
 *
 * - ``chip``: compact dropdown (thread header, lists, mobile).
 * - ``row``: label with the chip on the right (contact panel, channels); the inherited
 *   source shows in the menu and the chip tooltip, not as a line.
 * - ``cards``: three large choices (workspace default in settings).
 */
export default function AiHandlingPicker({
  handling,
  scope,
  onChange,
  canRaise,
  variant = 'chip',
  density = 'inline',
  saving = false,
  disabled = false,
  label,
  description,
  extraItems,
  hideSettingsLink,
  className,
  testId,
}: Props) {
  const { t } = useTranslation('common')
  const sourceLine = useSourceLine(handling, scope)

  if (variant === 'cards') {
    const inherited = handling ? inheritedEffective(handling) : null
    const selected = handling?.own ?? handling?.effective ?? null
    return (
      <div className={cn('space-y-2', className)} data-testid={testId ?? 'ai-handling-cards'}>
        <OptionCardGrid columns={3} className="gap-2" aria-label={t('aiHandling.title')}>
          {AI_HANDLING_MODES.map((mode) => {
            const allowed = canSetMode(canRaise, scope, mode, inherited)
            const active = selected === mode
            return (
              <div key={mode} className="h-full" title={allowed ? undefined : t('aiHandling.needsAdmin')}>
                <OptionCard
                  selected={active}
                  tone={AI_HANDLING_META[mode].tone === 'ai' ? 'ai' : 'accent'}
                  disabled={saving || disabled || !allowed}
                  data-testid={`ai-handling-card-${mode}`}
                  onClick={() => void onChange(mode)}
                  icon={<AiHandlingIcon mode={mode} size={16} />}
                  title={t(`aiHandling.modes.${mode}.label`)}
                  description={t(`aiHandling.modes.${mode}.description`)}
                  className="gap-1.5"
                />
              </div>
            )
          })}
        </OptionCardGrid>
        {handling ? <ClampNote handling={handling} /> : null}
      </div>
    )
  }

  const menu = (
    <DropdownMenu>
      <Chip
        handling={handling}
        saving={saving}
        disabled={disabled}
        testId={testId}
        className={variant === 'chip' ? className : undefined}
        title={sourceLine}
      />
      <ModeMenu
        handling={handling}
        scope={scope}
        canRaise={canRaise}
        onChange={onChange}
        extraItems={extraItems}
        hideSettingsLink={hideSettingsLink}
      />
    </DropdownMenu>
  )

  if (variant === 'chip') return menu

  return (
    <SettingRow density={density} label={label ?? ''} hint={description} className={className}>
      {menu}
    </SettingRow>
  )
}
