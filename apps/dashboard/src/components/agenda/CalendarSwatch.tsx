import { cn } from '../../lib/utils'

/** Square in the provider's calendar colour (Agenda calendar tone when unknown). */
export function CalendarSwatch({ color, className }: { color?: string | null; className?: string }) {
  return (
    <span
      className={cn('inline-block h-2.5 w-2.5 shrink-0 rounded-sm', !color && 'bg-status-info', className)}
      style={color ? { backgroundColor: color } : undefined}
      aria-hidden
    />
  )
}
