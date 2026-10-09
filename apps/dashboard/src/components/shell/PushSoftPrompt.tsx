import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BellRing, X } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import {
  dismissPushSoftPrompt,
  enableWebPush,
  getCurrentPushSubscription,
  getNotificationPermission,
  isPushSoftPromptDismissed,
  isWebPushServerConfigured,
  isWebPushSupported,
} from '../../lib/web-push'

/**
 * One soft ask per browser after sign-in. Never opens the native permission
 * dialog on its own — only after the person clicks Enable.
 */
export default function PushSoftPrompt() {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const [visible, setVisible] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token || !isWebPushSupported() || isPushSoftPromptDismissed()) {
      setVisible(false)
      return
    }
    let cancelled = false
    void (async () => {
      if (getNotificationPermission() === 'denied') return
      const [configured, sub] = await Promise.all([
        isWebPushServerConfigured(),
        getCurrentPushSubscription(),
      ])
      if (cancelled || !configured || sub) return
      setVisible(true)
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  const hide = useCallback(() => {
    dismissPushSoftPrompt()
    setVisible(false)
  }, [])

  const enable = useCallback(async () => {
    if (!token || busy) return
    setBusy(true)
    setError(null)
    try {
      await enableWebPush(token)
      dismissPushSoftPrompt()
      setVisible(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('pushSoftPrompt.failed'))
    } finally {
      setBusy(false)
    }
  }, [token, busy, t])

  if (!visible) return null

  return (
    <div
      className="flex h-9 items-center gap-2 border-b border-border/60 bg-bg px-3 text-xs text-text-secondary"
      data-testid="push-soft-prompt"
    >
      <BellRing size={14} className="shrink-0 text-text-muted" />
      <span className="min-w-0 truncate-fade">
        {error ?? t('pushSoftPrompt.body')}
      </span>
      <button
        type="button"
        disabled={busy || !token}
        onClick={() => void enable()}
        className="ml-auto shrink-0 h-6 rounded-md border border-border/70 px-2 text-xs font-medium text-text-heading transition-colors hover:bg-bg-hover disabled:opacity-50"
      >
        {t('pushSoftPrompt.enable')}
      </button>
      <button
        type="button"
        onClick={hide}
        aria-label={t('pushSoftPrompt.dismiss')}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-bg-hover hover:text-text-secondary"
      >
        <X size={13} aria-hidden />
      </button>
    </div>
  )
}
