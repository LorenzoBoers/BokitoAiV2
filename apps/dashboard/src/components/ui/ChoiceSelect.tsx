import { ChoiceOption, type ChoiceItem } from './ChoiceOption'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from './select'
import { cn } from '../../lib/utils'

export type ChoiceGroup = {
  label?: string
  items: ChoiceItem[]
}

type Props = {
  groups: ChoiceGroup[]
  value?: string
  onValueChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  triggerClassName?: string
  contentClassName?: string
  'aria-label'?: string
  id?: string
}

function findItem(groups: ChoiceGroup[], value: string | undefined): ChoiceItem | null {
  if (!value) return null
  for (const group of groups) {
    const hit = group.items.find((item) => item.value === value)
    if (hit) return hit
  }
  return null
}

/**
 * Select for named things (agents, people, teams, flows, projects, calendars).
 * The closed control and every row show the same mark.
 */
export function ChoiceSelect({
  groups,
  value,
  onValueChange,
  placeholder,
  disabled,
  triggerClassName,
  contentClassName,
  'aria-label': ariaLabel,
  id,
}: Props) {
  const selected = findItem(groups, value)
  const visible = groups.filter((group) => group.items.length > 0)

  return (
    <Select disabled={disabled} value={value || undefined} onValueChange={onValueChange}>
      <SelectTrigger id={id} className={cn('h-8 text-sm', triggerClassName)} aria-label={ariaLabel}>
        {selected ? (
          <ChoiceOption item={selected} size={16} className="min-w-0 flex-1" />
        ) : (
          <SelectValue placeholder={placeholder} />
        )}
      </SelectTrigger>
      <SelectContent
        position="popper"
        sideOffset={4}
        className={cn(
          'max-h-[min(20rem,var(--radix-select-content-available-height))] w-[var(--radix-select-trigger-width)] min-w-[14rem]',
          contentClassName,
        )}
      >
        {visible.map((group, index) => (
          <SelectGroup key={group.label ?? `group-${index}`}>
            {group.label ? <SelectLabel>{group.label}</SelectLabel> : null}
            {group.items.map((item) => (
              <SelectItem key={item.value} value={item.value} textValue={item.label} disabled={item.disabled}>
                <ChoiceOption item={item} size={18} />
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}
