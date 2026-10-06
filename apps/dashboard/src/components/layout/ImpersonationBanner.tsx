import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Eye, Loader2 } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { Button } from '../ui/button'

export default function ImpersonationBanner() {
  const { t } = useTranslation('nav')
  const { user, isImpersonating, stopImpersonation } = useAuth()
  const [stopping, setStopping] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isImpersonating || !user) return null

  const onStop = async () => {
    if (stopping) return
    setStopping(true)
    setError(null)
    try {
      await stopImpersonation()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('impersonation.stopError'))
      setStopping(false)
    }
  }

  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-status-warning/40 bg-status-warning/12 px-3 text-xs text-text">
      <Eye size={14} className="shrink-0 text-status-warning" aria-hidden />
      <span className="min-w-0 flex-1 truncate">
        {t('impersonation.banner', {
          name: user.name || user.email,
          email: user.email,
          workspace: user.tenant?.name || user.tenant?.slug || '',
        })}
      </span>
      {error ? <span className="shrink-0 text-status-error">{error}</span> : null}
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="h-6 shrink-0 px-2 text-2xs"
        disabled={stopping}
        onClick={() => void onStop()}
      >
        {stopping ? <Loader2 size={12} className="animate-spin" /> : t('impersonation.stop')}
      </Button>
    </div>
  )
}
