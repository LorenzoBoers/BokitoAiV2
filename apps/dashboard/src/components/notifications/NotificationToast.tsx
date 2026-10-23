import { X } from 'lucide-react'
import { toast } from 'sonner'
import { Link } from 'react-router-dom'
import { Button } from '../ui/button'
import { TextLink } from '../ui/text-link'
import { NotificationFromMark } from './NotificationFromMark'
import { notificationFromHref, type NotificationFrom } from '../../lib/notification-from'

/** Drop a body line that only repeats the sender name already shown above. */
function stripLeadingFromName(body: string, fromName?: string): string {
  if (!body || !fromName) return body
  const lines = body.split('\n')
  if (lines[0]?.trim().toLowerCase() === fromName.trim().toLowerCase()) {
    return lines.slice(1).join('\n').trim()
  }
  return body
}

export type NotificationToastProps = {
  toastId: string | number
  title: string
  body?: string
  from?: NotificationFrom | null
  openLabel: string
  href?: string | null
  onOpen?: () => void
}

/**
 * Live conversation toast: glassy surface, accent Open, avatar when a sender
 * is known (user / agent / contact). System notices without `from` stay text-only.
 */
export function NotificationToast({
  toastId,
  title,
  body,
  from,
  openLabel,
  href,
  onOpen,
}: NotificationToastProps) {
  const fromHref = from ? notificationFromHref(from) : null
  const description = stripLeadingFromName((body || '').trim(), from?.name)

  return (
    <div
      className="notification-toast-glass relative pointer-events-auto flex w-[min(380px,calc(100vw-1.5rem))] items-start gap-3 rounded-xl p-3"
      data-testid="notification-toast"
    >
      <button
        type="button"
        onClick={() => toast.dismiss(toastId)}
        className="absolute -left-1.5 -top-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full border border-border bg-bg-elevated/70 text-text-muted shadow-sm backdrop-blur-md hover:bg-bg-hover hover:text-text-heading"
        aria-label="Close"
      >
        <X size={10} strokeWidth={2.5} aria-hidden />
      </button>

      {from ? (
        fromHref ? (
          <Link
            to={fromHref}
            onClick={() => toast.dismiss(toastId)}
            className="mt-0.5 shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus"
            aria-label={from.name}
          >
            <NotificationFromMark from={from} size={36} />
          </Link>
        ) : (
          <div className="mt-0.5 shrink-0">
            <NotificationFromMark from={from} size={36} />
          </div>
        )
      ) : null}

      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-sm font-medium leading-snug text-text-heading">{title}</p>
        {from ? (
          <p className="mt-0.5 text-xs text-text-secondary">
            {fromHref ? (
              <TextLink
                to={fromHref}
                tone="muted"
                className="font-medium text-text-secondary hover:text-accent"
                onClick={() => toast.dismiss(toastId)}
              >
                {from.name}
              </TextLink>
            ) : (
              <span className="font-medium">{from.name}</span>
            )}
          </p>
        ) : null}
        {description ? (
          <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-text-secondary whitespace-pre-line">
            {description}
          </p>
        ) : null}
      </div>

      {href && onOpen ? (
        <Button
          type="button"
          size="sm"
          className="shrink-0 self-center"
          onClick={() => {
            toast.dismiss(toastId)
            onOpen()
          }}
        >
          {openLabel}
        </Button>
      ) : null}
    </div>
  )
}
