import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select'
import { AgentOptionRow, type AgentVisualFields } from './AgentOptionRow'
import { cn } from '../../lib/utils'

type Props = {
  agents: AgentVisualFields[]
  value?: string
  onValueChange: (agentId: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  triggerClassName?: string
  /** Optional first empty option (e.g. lead default). Value is passed through as-is. */
  emptyOption?: { value: string; label: string }
  'aria-label'?: string
}

/** Agent picker with avatar/color; use wherever an agent is chosen. */
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
  const selected = agents.find((a) => a.id === value) ?? null
  const selectValue =
    value || (emptyOption && !value ? emptyOption.value : undefined) || undefined

  return (
    <Select
      disabled={disabled}
      value={selectValue}
      onValueChange={onValueChange}
    >
      <SelectTrigger
        className={cn('h-8 text-sm', triggerClassName)}
        aria-label={ariaLabel}
      >
        {selected ? (
          <AgentOptionRow agent={selected} size={18} />
        ) : emptyOption && (!value || value === emptyOption.value) ? (
          <span className="truncate text-sm text-text-secondary">{emptyOption.label}</span>
        ) : (
          <SelectValue placeholder={placeholder} />
        )}
      </SelectTrigger>
      <SelectContent className={cn('min-w-[14rem]', className)}>
        {emptyOption ? (
          <SelectItem value={emptyOption.value}>{emptyOption.label}</SelectItem>
        ) : null}
        {agents.map((agent) => (
          <SelectItem key={agent.id} value={agent.id} textValue={agent.name}>
            <AgentOptionRow agent={agent} size={18} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
