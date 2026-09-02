import { Check } from 'lucide-react'
import { cn } from '../../lib/utils'

/** Shared step indicator for channel connect wizards (WhatsApp, SMTP/IMAP, Slack). */
export default function ConnectStepRail({
  steps,
  active,
  done,
  ariaLabel,
}: {
  steps: string[]
  active: number
  done: number[]
  ariaLabel: string
}) {
  return (
    <ol className="flex items-stretch gap-1.5" aria-label={ariaLabel}>
      {steps.map((label, index) => {
        const number = index + 1
        const isDone = done.includes(number)
        const isActive = active === number
        const isOpen = number <= active
        return (
          <li
            key={label}
            className={cn(
              'flex min-w-0 flex-1 items-center gap-2 rounded-lg border px-2.5 py-2',
              isActive
                ? 'border-accent/40 bg-accent/10'
                : isDone || isOpen
                  ? 'border-border/50 bg-bg-elevated/40'
                  : 'border-border/40 bg-transparent opacity-55',
            )}
          >
            <span
              className={cn(
                'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
                isActive
                  ? 'bg-accent text-white'
                  : isDone
                    ? 'bg-accent/20 text-accent'
                    : isOpen
                      ? 'bg-bg-hover text-text-secondary'
                      : 'bg-bg-hover text-text-muted',
              )}
              aria-hidden
            >
              {isDone && !isActive ? <Check size={11} strokeWidth={2.5} /> : number}
            </span>
            <span
              className={cn(
                'min-w-0 truncate text-[11px] font-medium leading-tight',
                isActive || isOpen ? 'text-text-heading' : 'text-text-secondary',
              )}
            >
              {label}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
