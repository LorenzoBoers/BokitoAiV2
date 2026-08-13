import { Mail, MailOpen, Pin, PinOff } from 'lucide-react'
import { cn } from '../../lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'

type Props = {
  hasUnread: boolean
  isPinned: boolean
  onMarkRead: () => void
  onMarkUnread: () => void
  onTogglePin: () => void
}

/**
 * Indicator + dropdown shown left of every thread in the list. Three visual
 * states for the indicator, in priority order:
 *
 *   - isPinned   -> small Pin icon (accent color)
 *   - hasUnread  -> filled accent dot (current "ongelezen" indicator)
 *   - else       -> transparent placeholder
 *
 * Hovering the parent thread row reveals a subtle ring around the indicator
 * (group-hover) so users discover the click target. Hovering the indicator
 * itself lightens the dot / background so the hit area reads as interactive.
 * Clicking opens a Radix dropdown with contextual actions (mark read/unread +
 * pin/unpin).
 */
export default function ThreadIndicatorMenu({
  hasUnread,
  isPinned,
  onMarkRead,
  onMarkUnread,
  onTogglePin,
}: Props) {
  const stop = (e: React.MouseEvent | React.PointerEvent | React.KeyboardEvent) => {
    e.stopPropagation()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={stop}
          onPointerDown={stop}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') stop(e)
          }}
          aria-label={
            isPinned
              ? 'Thread actions (pinned)'
              : hasUnread
                ? 'Thread actions (unread)'
                : 'Thread actions'
          }
          className={cn(
            'group/indicator mt-1.5 shrink-0 inline-flex h-4 w-4 items-center justify-center rounded-full',
            'transition-[background-color,box-shadow] duration-150 ring-0',
            'hover:bg-text-muted/15 dark:hover:bg-text-muted/25',
            'group-hover/thread:ring-1 group-hover/thread:ring-border/70',
            'data-[state=open]:ring-1 data-[state=open]:ring-accent/60',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60',
          )}
        >
          {isPinned ? (
            <Pin
              size={11}
              className="text-accent fill-accent rotate-45 transition-opacity group-hover/indicator:opacity-90"
              aria-hidden
            />
          ) : hasUnread ? (
            <span
              className="h-2 w-2 rounded-full bg-accent transition-[filter,transform] duration-150 group-hover/indicator:scale-110 group-hover/indicator:brightness-110"
              aria-hidden
            />
          ) : (
            <span
              className="h-2 w-2 rounded-full bg-text-muted/25 transition-colors duration-150 group-hover/indicator:bg-text-muted/55 dark:group-hover/indicator:bg-text-muted/50"
              aria-hidden
            />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        onClick={(e) => e.stopPropagation()}
      >
        {hasUnread ? (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault()
              onMarkRead()
            }}
            className="gap-2"
          >
            <MailOpen size={14} className="text-text-muted" />
            Mark as read
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault()
              onMarkUnread()
            }}
            className="gap-2"
          >
            <Mail size={14} className="text-text-muted" />
            Mark as unread
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault()
            onTogglePin()
          }}
          className="gap-2"
        >
          {isPinned ? (
            <>
              <PinOff size={14} className="text-text-muted" />
              Unpin
            </>
          ) : (
            <>
              <Pin size={14} className="text-text-muted" />
              Pin
            </>
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
