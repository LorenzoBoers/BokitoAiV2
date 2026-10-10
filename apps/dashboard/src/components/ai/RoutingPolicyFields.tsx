import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeftRight, CheckCheck, RotateCcw, UserRoundCheck, type LucideIcon } from 'lucide-react'
import {
  AFTER_HUMAN_REPLY_OPTIONS,
  REOPEN_OWNER_OPTIONS,
  type RoutingKey,
  type RoutingPolicy,
} from '../../lib/ai-handling-api'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Switch } from '../ui/switch'
import { DefaultBadge } from '../ui/DefaultBadge'
import { Label } from '../ui/label'
import { SettingRow } from '../ui/entity-row'
import { cn } from '../../lib/utils'

type Props = {
  /** Values to show (the effective policy). */
  value: RoutingPolicy
  /**
   * Channel mode: which keys this channel overrides and what the workspace
   * default is. Omit for the workspace settings page.
   */
  own?: Partial<RoutingPolicy>
  inherited?: RoutingPolicy
  /** `null` clears a channel override (follow the workspace default). */
  onChange: <K extends RoutingKey>(key: K, next: RoutingPolicy[K] | null) => void
  disabled?: boolean
  /** `card`: icon rows for the settings page; `list`: compact channel panel rows. */
  variant?: 'card' | 'list'
  idPrefix?: string
}

function Row({
  icon: Icon,
  htmlFor,
  label,
  hint,
  children,
  variant,
  first,
}: {
  icon: LucideIcon
  htmlFor: string
  label: string
  hint: string
  children: ReactNode
  variant: 'card' | 'list'
  first: boolean
}) {
  if (variant === 'list') {
    return (
      <SettingRow density="field" htmlFor={htmlFor} label={label} hint={hint}>
        {children}
      </SettingRow>
    )
  }
  return (
    <div className={cn('flex items-start justify-between gap-4', !first && 'border-t border-border/60 pt-5')}>
      <div className="flex items-start gap-3">
        <Icon size={16} className="mt-0.5 text-accent" />
        <div>
          <Label htmlFor={htmlFor} className="text-sm font-medium">
            {label}
          </Label>
          <p className="mt-0.5 max-w-sm text-xs text-text-muted">{hint}</p>
        </div>
      </div>
      {children}
    </div>
  )
}

/**
 * The four routing-policy fields (after a person replies, auto-close after
 * agent / person reply, owner on reopen). On a channel the option that matches
 * the workspace default carries the Bedrijfsstandaard badge. Picking it clears
 * the channel override.
 */
export function RoutingPolicyFields({
  value,
  own,
  inherited,
  onChange,
  disabled,
  variant = 'card',
  idPrefix = 'routing',
}: Props) {
  const { t } = useTranslation('nav')
  const { t: tc } = useTranslation('common')
  const channelMode = own !== undefined && inherited !== undefined
  const inheritLabel = tc('aiHandling.defaultBadge.workspace')
  const triggerClass =
    variant === 'list' ? 'h-8 w-full min-w-0 max-w-[16rem] text-xs' : 'w-56'

  const optionLabel = (label: string, standard: boolean) => (
    <span className="flex w-full min-w-0 items-center gap-2">
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {standard ? <DefaultBadge className="px-1.5 py-0 text-2xs">{inheritLabel}</DefaultBadge> : null}
    </span>
  )

  const choiceSelect = <K extends 'afterHumanReply' | 'reopenOwner'>(
    key: K,
    options: readonly RoutingPolicy[K][],
    labelFor: (option: RoutingPolicy[K]) => string,
  ) => {
    const current = String(value[key])
    const inheritedValue = channelMode ? String(inherited![key]) : ''
    return (
      <Select
        value={current}
        disabled={disabled}
        onValueChange={(next) =>
          onChange(key, channelMode && next === inheritedValue ? null : (next as RoutingPolicy[K]))
        }
      >
        <SelectTrigger id={`${idPrefix}-${key}`} className={triggerClass}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => {
            const label = labelFor(option)
            const standard = channelMode && String(option) === inheritedValue
            return (
              <SelectItem key={String(option)} value={String(option)} textValue={label}>
                {optionLabel(label, standard)}
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
    )
  }

  const boolControl = (key: 'closeAfterAgentReply' | 'closeAfterHumanReply') => {
    if (!channelMode) {
      return (
        <Switch
          id={`${idPrefix}-${key}`}
          checked={value[key]}
          disabled={disabled}
          onCheckedChange={(checked) => onChange(key, checked)}
        />
      )
    }
    const onOff = (flag: boolean) => (flag ? t('ai.communication.routing.on') : t('ai.communication.routing.off'))
    const current = value[key] ? 'on' : 'off'
    const inheritedValue = inherited![key] ? 'on' : 'off'
    return (
      <Select
        value={current}
        disabled={disabled}
        onValueChange={(next) => onChange(key, next === inheritedValue ? null : next === 'on')}
      >
        <SelectTrigger id={`${idPrefix}-${key}`} className={triggerClass}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(['on', 'off'] as const).map((option) => (
            <SelectItem key={option} value={option} textValue={onOff(option === 'on')}>
              {optionLabel(onOff(option === 'on'), option === inheritedValue)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  return (
    <div className={variant === 'card' ? 'space-y-5' : 'divide-y divide-border/40'} data-testid={`${idPrefix}-fields`}>
      <Row
        first
        variant={variant}
        icon={ArrowLeftRight}
        htmlFor={`${idPrefix}-afterHumanReply`}
        label={t('ai.communication.routing.afterHumanReply.label')}
        hint={t(`ai.communication.routing.afterHumanReply.options.${value.afterHumanReply}.hint`)}
      >
        {choiceSelect('afterHumanReply', AFTER_HUMAN_REPLY_OPTIONS, (option) =>
          t(`ai.communication.routing.afterHumanReply.options.${option}.label`),
        )}
      </Row>
      <Row
        first={false}
        variant={variant}
        icon={CheckCheck}
        htmlFor={`${idPrefix}-closeAfterAgentReply`}
        label={t('ai.communication.routing.closeAfterAgentReply.label')}
        hint={t('ai.communication.routing.closeAfterAgentReply.hint')}
      >
        {boolControl('closeAfterAgentReply')}
      </Row>
      <Row
        first={false}
        variant={variant}
        icon={UserRoundCheck}
        htmlFor={`${idPrefix}-closeAfterHumanReply`}
        label={t('ai.communication.routing.closeAfterHumanReply.label')}
        hint={t('ai.communication.routing.closeAfterHumanReply.hint')}
      >
        {boolControl('closeAfterHumanReply')}
      </Row>
      <Row
        first={false}
        variant={variant}
        icon={RotateCcw}
        htmlFor={`${idPrefix}-reopenOwner`}
        label={t('ai.communication.routing.reopenOwner.label')}
        hint={t(`ai.communication.routing.reopenOwner.options.${value.reopenOwner}.hint`)}
      >
        {choiceSelect('reopenOwner', REOPEN_OWNER_OPTIONS, (option) =>
          t(`ai.communication.routing.reopenOwner.options.${option}.label`),
        )}
      </Row>
    </div>
  )
}
