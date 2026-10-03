import { cn } from '../../lib/utils'
import { Tip } from './Tip'

export type ThreadDotStatus = 'open' | 'pending' | 'closed' | 'spam'

interface ThreadStatusDotProps {
  /** Thread status; unknown values fall back to `open`. */
  status?: string | null
  /** Unread wins over status: filled accent dot. */
  unread?: boolean
  className?: string
  title?: string
}

/**
 * One 8px dot for a conversation's state, used in every thread list on the
 * platform (Communication list, contact panel, Contacts, agent pages):
 *
 *   unread   filled accent
 *   open     muted fill
 *   pending  warning fill (snoozed / waiting)
 *   closed   hollow ring
 *   spam     error fill, dimmed
 */
export function ThreadStatusDot({ status, unread = false, className, title }: ThreadStatusDotProps) {
  const state: ThreadDotStatus =
    status === 'pending' || status === 'closed' || status === 'spam' ? status : 'open'
  const dot = (
    <span
      aria-hidden={title ? undefined : true}
      className={cn(
        'inline-block h-2 w-2 shrink-0 rounded-full',
        unread
          ? 'bg-accent'
          : state === 'pending'
            ? 'bg-status-warning'
            : state === 'closed'
              ? 'border border-text-muted/45 bg-transparent'
              : state === 'spam'
                ? 'bg-status-error/70'
                : 'bg-text-muted/35',
        className,
      )}
    />
  )
  return title ? <Tip label={title}>{dot}</Tip> : dot
}

export default ThreadStatusDot
