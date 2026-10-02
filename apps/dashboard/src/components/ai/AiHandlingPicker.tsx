import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Check, ChevronDown, CornerUpLeft, Settings2, ShieldAlert } from 'lucide-react'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import { AiHandlingIcon } from './AiHandlingIcon'

export const AI_HANDLING_SETTINGS_PATH = '/settings/communication'

type Props = {
  handling: AiHandling | null
  scope: AiHandlingScope
  onChange: (mode: AiHandlingMode | null) => void | Promise<void>
  /** Owner/admin: may raise to autonomous at any scope. */
  canRaise: boolean
  variant?: 'chip' | 'row' | 'cards'
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
  const sourceLine = useSourceLine(handling, scope)
  const inherited = handling ? inheritedEffective(handling) : null
  const reason = handling?.own && handling.reason ? t(`aiHandling.reasons.${handling.reason}`, '') : ''
  return (
    <DropdownMenuContent align="end" className="w-72">
      <div className="space-y-1 px-2 py-1.5">
        <p className="text-xs font-medium text-text-heading">{t('aiHandling.title')}</p>
        {sourceLine ? <p className="text-xs text-text-muted">{sourceLine}</p> : null}
        {reason ? <p className="text-xs text-text-secondary">{reason}</p> : null}
        {handling ? <ClampNote handling={handling} /> : null}
      </div>
      <DropdownMenuSeparator />
      {AI_HANDLING_MODES.map((mode) => {
        const allowed = canSetMode(canRaise, scope, mode, inherited)
        const selected = handling?.own ? handling.own === mode : false
        return (
          <DropdownMenuItem
            key={mode}
            disabled={!allowed}
            data-testid={`ai-handling-option-${mode}`}
            className="items-start gap-2.5 py-2"
            title={allowed ? undefined : t('aiHandling.needsAdmin')}
            onSelect={() => void onChange(mode)}
          >
            <AiHandlingIcon mode={mode} size={14} className="mt-0.5" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-text-heading">
                {t(`aiHandling.modes.${mode}.label`)}
              </span>
              <span className="block text-xs leading-snug text-text-muted">
                {t(`aiHandling.modes.${mode}.description`)}
              </span>
            </span>
            {selected ? <Check size={14} className="mt-0.5 shrink-0 text-text-secondary" /> : null}
          </DropdownMenuItem>
        )
      })}
      {handling?.own && scope !== 'workspace' ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="items-start gap-2.5 py-2"
            data-testid="ai-handling-option-inherit"
            disabled={!canSetMode(canRaise, scope, null)}
            onSelect={() => void onChange(null)}
          >
            <CornerUpLeft size={14} className="mt-0.5 shrink-0 text-text-muted" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-text-heading">
                {t('aiHandling.useInherited', {
                  source: t(`aiHandling.sources.${handling.inheritedSource}`),
                })}
              </span>
              {inherited ? (
                <span className="block text-xs text-text-muted">
                  {t('aiHandling.useInheritedHint', {
                    mode: t(`aiHandling.modes.${inherited}.label`),
                  })}
                </span>
              ) : null}
            </span>
          </DropdownMenuItem>
        </>
      ) : null}
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
}: {
  handling: AiHandling | null
  saving?: boolean
  disabled?: boolean
  testId?: string
  className?: string
  compact?: boolean
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
        data-testid={testId ?? 'ai-handling-chip'}
        data-mode={mode}
        className={cn(
          'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border/70 px-2 text-xs font-medium text-text-heading transition-colors hover:bg-bg-hover/70 disabled:opacity-50',
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
 * - ``row``: label and description with the chip on the right (contact panel, channels).
 * - ``cards``: three large choices (workspace default in settings).
 */
export default function AiHandlingPicker({
  handling,
  scope,
  onChange,
  canRaise,
  variant = 'chip',
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
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t('aiHandling.title')}>
          {AI_HANDLING_MODES.map((mode) => {
            const allowed = canSetMode(canRaise, scope, mode, inherited)
            const active = selected === mode
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={saving || disabled || !allowed}
                title={allowed ? undefined : t('aiHandling.needsAdmin')}
                data-testid={`ai-handling-card-${mode}`}
                onClick={() => void onChange(mode)}
                className={cn(
                  'flex flex-col items-start gap-1.5 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                  active
                    ? AI_HANDLING_META[mode].tone === 'ai'
                      ? 'border-ai/40 bg-ai/[0.07]'
                      : 'border-text-muted/40 bg-bg-elevated'
                    : 'border-border/70 hover:bg-bg-hover/50',
                )}
              >
                <span className="flex w-full items-center gap-2">
                  <AiHandlingIcon mode={mode} size={16} />
                  <span className="text-sm font-medium text-text-heading">
                    {t(`aiHandling.modes.${mode}.label`)}
                  </span>
                  {active ? <Check size={14} className="ml-auto text-text-secondary" /> : null}
                </span>
                <span className="text-xs leading-snug text-text-muted">
                  {t(`aiHandling.modes.${mode}.description`)}
                </span>
              </button>
            )
          })}
        </div>
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
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        {label ? <p className="text-sm font-medium text-text-heading">{label}</p> : null}
        {description ? <p className="mt-0.5 text-xs text-text-muted">{description}</p> : null}
        {sourceLine ? <p className="mt-0.5 text-xs text-text-secondary">{sourceLine}</p> : null}
      </div>
      {menu}
    </div>
  )
}
