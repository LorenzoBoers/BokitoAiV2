import type { TicketStageField } from '../../lib/tickets-api'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import { Textarea } from '../ui/textarea'

type Props = {
  field: TicketStageField
  value: string
  disabled?: boolean
  onChange: (value: string) => void
  onBlur?: (value: string) => void
  className?: string
  placeholder?: string
  /** Single-line inputs: Enter blurs, so the value saves through onBlur. */
  commitOnEnter?: boolean
}

/** Renders one ticket intake field with the styled Select for enums. */
export function TicketFieldControl({
  field,
  value,
  disabled,
  onChange,
  onBlur,
  className,
  placeholder,
  commitOnEnter,
}: Props) {
  if (field.type === 'enum') {
    const options = field.options ?? []
    return (
      <Select
        value={value || undefined}
        onValueChange={onChange}
        disabled={disabled || options.length === 0}
      >
        <SelectTrigger className={className ?? 'h-9 text-sm'} aria-label={field.name}>
          <SelectValue placeholder={placeholder ?? field.name} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  if (field.type === 'textarea') {
    return (
      <Textarea
        value={value}
        disabled={disabled}
        rows={3}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onBlur?.(e.currentTarget.value)}
        aria-label={field.name}
        className={className}
      />
    )
  }

  return (
    <Input
      type={field.type === 'number' ? 'number' : 'text'}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onBlur={(e) => onBlur?.(e.currentTarget.value)}
      onKeyDown={
        commitOnEnter
          ? (e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }
          : undefined
      }
      aria-label={field.name}
      className={className}
    />
  )
}
