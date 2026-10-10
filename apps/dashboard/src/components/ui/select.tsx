import * as SelectPrimitive from '@radix-ui/react-select'
import { ChevronDown } from 'lucide-react'
import { cn } from '../../lib/utils'

/** Compact closed control shared by selects and menu chips. */
export const controlChipClass =
  'inline-flex h-7 w-auto max-w-[14rem] shrink-0 items-center justify-between gap-1.5 rounded-md border border-border/70 bg-transparent px-2 text-xs font-medium text-text-heading outline-none transition-colors hover:bg-bg-hover/70 focus:border-border/70 disabled:opacity-50'

function Select(props: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root {...props} />
}

function SelectValue(props: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value {...props} />
}

function SelectTrigger({
  className,
  children,
  variant = 'field',
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  /** `chip` matches menu chips; `field` is the full form control. */
  variant?: 'field' | 'chip'
}) {
  const chip = variant === 'chip'
  return (
    <SelectPrimitive.Trigger
      className={cn(
        chip
          ? controlChipClass
          : 'flex h-10 w-full items-center justify-between rounded-lg border border-border/60 bg-bg-input px-3.5 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-border-focus',
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown size={chip ? 11 : 14} className="shrink-0 text-text-muted" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectContent({
  className,
  children,
  position = 'popper',
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position={position}
        sideOffset={sideOffset}
        className={cn(
          // Above dialogs (z-50) so pickers stay usable in channel access and other modals.
          'z-[100] overflow-hidden rounded-lg border border-border/60 bg-bg-surface shadow-overlay data-[state=open]:animate-pop-in',
          position === 'popper' &&
            'data-[side=bottom]:translate-y-0 data-[side=top]:translate-y-0 min-w-[var(--radix-select-trigger-width)]',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport
          className={cn('p-1', position === 'popper' && 'w-full min-w-[var(--radix-select-trigger-width)]')}
        >
          {children}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        'relative flex min-h-9 w-full min-w-0 cursor-default select-none items-center overflow-hidden rounded-md px-2.5 py-1.5 text-sm text-text-primary outline-none',
        'data-[highlighted]:bg-bg-hover/80 data-[state=checked]:bg-accent/15 data-[highlighted]:data-[state=checked]:bg-accent/20',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText asChild>
        <span className="flex min-w-0 flex-1 items-center overflow-hidden">{children}</span>
      </SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  )
}

function SelectGroup(props: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return <SelectPrimitive.Group {...props} />
}

function SelectLabel({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      className={cn('px-2.5 pb-1 pt-1.5 text-2xs font-semibold uppercase tracking-wide text-text-muted', className)}
      {...props}
    />
  )
}

function SelectSeparator({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return <SelectPrimitive.Separator className={cn('my-1 h-px bg-border/60', className)} {...props} />
}

export { Select, SelectValue, SelectTrigger, SelectContent, SelectItem, SelectGroup, SelectLabel, SelectSeparator }
