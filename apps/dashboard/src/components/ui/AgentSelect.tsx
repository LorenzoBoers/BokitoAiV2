import { ChoiceSelect } from './ChoiceSelect'
import type { ChoiceItem } from './ChoiceOption'
import type { AgentVisualFields } from './AgentOptionRow'
import { DefaultBadge } from './DefaultBadge'

type Props = {
  agents: AgentVisualFields[]
  value?: string
  onValueChange: (agentId: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  triggerClassName?: string
  /** Optional first empty option (e.g. lead default). Value is passed through as-is. */
  emptyOption?: { value: string; label: string; badge?: string }
  'aria-label'?: string
}

/** Agent picker with avatar. Prefer `ChoiceSelect` when the menu mixes kinds. */
export function AgentSelect({
  agents,
  value = '',
  onValueChange,
  placeholder,
  disabled,
  className,
  triggerClassName,
  emptyOption,
  'aria-label': ariaLabel,
}: Props) {
  const selectValue = value || (emptyOption && !value ? emptyOption.value : undefined) || undefined
  const items: ChoiceItem[] = [
    ...(emptyOption
      ? [
          {
            value: emptyOption.value,
            label: emptyOption.label,
            kind: 'icon' as const,
            trailing: emptyOption.badge ? <DefaultBadge>{emptyOption.badge}</DefaultBadge> : undefined,
          },
        ]
      : []),
    ...agents.map(
      (agent): ChoiceItem => ({
        value: agent.id,
        label: agent.name,
        kind: 'agent',
        agent,
      }),
    ),
  ]

  return (
    <ChoiceSelect
      groups={[{ items }]}
      value={selectValue}
      onValueChange={onValueChange}
      placeholder={placeholder}
      disabled={disabled}
      triggerClassName={triggerClassName}
      contentClassName={className}
      aria-label={ariaLabel}
    />
  )
}
