import { Button } from './button'

type ApiErrorBannerProps = {
  message: string
  onRetry?: () => void
  className?: string
}

/** User-safe API error with optional retry (no raw paths or stack traces). */
export function ApiErrorBanner({ message, onRetry, className = '' }: ApiErrorBannerProps) {
  return (
    <div
      className={`rounded-lg border border-status-error/30 bg-status-error/10 px-4 py-3 text-sm text-status-error ${className}`}
      role="alert"
    >
      <p>{message}</p>
      {onRetry ? (
        <Button type="button" size="sm" variant="ghost" className="mt-2 h-7 px-2 text-xs" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  )
}

export function formatApiErrorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (err instanceof Error) {
    const msg = err.message.trim()
    if (!msg) return fallback
    const parsed = msg.match(/^HTTP \d+\s+(.+?)\s*\[[^\]]+\]$/)
    if (parsed?.[1]) return parsed[1]
    if (/^HTTP \d+/i.test(msg) || msg.includes('[/') || msg.includes('/api/')) {
      return fallback
    }
    return msg
  }
  return fallback
}
