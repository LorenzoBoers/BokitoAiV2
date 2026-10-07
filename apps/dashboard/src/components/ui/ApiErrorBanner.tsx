import { useTranslation } from 'react-i18next'
import { Button } from './button'
import { Callout } from './callout'

type ApiErrorBannerProps = {
  message: string
  onRetry?: () => void
  className?: string
}

/** User-safe API error with optional retry (no raw paths or stack traces). */
export function ApiErrorBanner({ message, onRetry, className }: ApiErrorBannerProps) {
  const { t } = useTranslation('common')
  return (
    <Callout
      tone="error"
      className={className}
      actions={
        onRetry ? (
          <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onRetry}>
            {t('actions.retry')}
          </Button>
        ) : null
      }
    >
      {message}
    </Callout>
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
