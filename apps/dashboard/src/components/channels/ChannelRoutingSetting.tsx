import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useAuth } from '../../context/AuthContext'
import { useIsAdmin } from '../../hooks/useIsAdmin'
import {
  getChannelRouting,
  setChannelRouting,
  type ChannelRoutingPolicy,
  type RoutingKey,
  type RoutingPolicy,
} from '../../lib/ai-handling-api'
import { RoutingPolicyFields } from '../ai/RoutingPolicyFields'
import { LoadingBlock } from '../ui/loading-block'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'

/**
 * Routing policy for one channel. Every value follows the workspace default
 * until the channel sets its own (first option in each select).
 */
export default function ChannelRoutingSetting({ accountId }: { accountId: string }) {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const isAdmin = useIsAdmin()
  const [policy, setPolicy] = useState<ChannelRoutingPolicy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    setPolicy(null)
    getChannelRouting(token, accountId)
      .then((next) => {
        if (!cancelled) {
          setPolicy(next)
          setError(null)
        }
      })
      .catch((err) => {
        if (!cancelled) setError(formatApiErrorMessage(err, t('ai.communication.loadError')))
      })
    return () => {
      cancelled = true
    }
  }, [token, accountId, t])

  const change = async <K extends RoutingKey>(key: K, next: RoutingPolicy[K] | null) => {
    if (!token || busy) return
    setBusy(true)
    try {
      setPolicy(await setChannelRouting(token, accountId, { [key]: next }))
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('ai.communication.saveError')))
    } finally {
      setBusy(false)
    }
  }

  if (error) return <p className="py-2 text-xs text-status-error">{error}</p>
  if (!policy) return <LoadingBlock variant="inline" label={t('ai.communication.loadingConfig')} />
  return (
    <RoutingPolicyFields
      variant="list"
      idPrefix={`channel-routing-${accountId}`}
      value={policy.effective}
      own={policy.own}
      inherited={policy.inherited}
      disabled={!isAdmin || busy}
      onChange={(key, next) => void change(key, next)}
    />
  )
}
