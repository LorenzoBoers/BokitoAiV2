import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { RefreshCw, AlertCircle, CheckCircle, Folder } from 'lucide-react'
import { formatApiErrorMessage } from '../ui/ApiErrorBanner'
import { useAuth } from '../../context/AuthContext'
import { syncMailboxes } from '../../lib/email-api'
import { getSyncStatus, type SyncConnectionStatus } from '../../lib/inbox-api'
import { mailboxStatusLabel } from '../../lib/status-labels'
import { cn } from '../../lib/utils'

function formatDate(iso: string | null, neverLabel: string): string {
  if (!iso) return neverLabel
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '–'
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

type Props = {
  className?: string
}

export default function SyncStatusPanel({ className }: Props) {
  const { t } = useTranslation('nav')
  const { token } = useAuth()
  const [statuses, setStatuses] = useState<SyncConnectionStatus[]>([])
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const result = await getSyncStatus(token)
      setStatuses(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('syncStatus.couldNotLoad'))
    } finally {
      setLoading(false)
    }
  }, [token, t])

  const syncNow = useCallback(async () => {
    if (!token || syncing) return
    setSyncing(true)
    try {
      const result = await syncMailboxes(token)
      toast.success(
        result.synced > 0
          ? t('syncStatus.synced', { count: result.synced })
          : t('syncStatus.syncedNone'),
      )
      await load()
    } catch (err) {
      toast.error(formatApiErrorMessage(err, t('syncStatus.couldNotSync')))
    } finally {
      setSyncing(false)
    }
  }, [token, syncing, load, t])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text-heading">{t('syncStatus.title')}</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void syncNow()}
            disabled={loading || syncing}
            className="rounded-md border border-border/60 px-2 py-1 text-[11px] font-medium text-text-secondary hover:bg-bg-hover/60 disabled:opacity-40"
          >
            {syncing ? t('syncStatus.syncing') : t('syncStatus.syncNow')}
          </button>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || syncing}
            className="text-text-muted hover:text-text-primary transition-colors disabled:opacity-40"
            title={t('syncStatus.refresh')}
          >
            <RefreshCw size={14} className={loading || syncing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {error ? (
        <p className="text-xs text-status-error">{error}</p>
      ) : statuses.length === 0 && !loading ? (
        <div className="space-y-1">
          <p className="text-xs text-text-muted">{t('syncStatus.noMailboxes')}</p>
          <p className="text-[11px] text-text-muted/80">{t('syncStatus.openChannelsHint')}</p>
        </div>
      ) : (
        statuses.map((conn) => (
          <div key={conn.id} className="rounded-lg border border-border/60 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-text-heading truncate">{conn.mailboxEmail || conn.displayName}</span>
              <span
                className={cn(
                  'text-xs font-medium shrink-0',
                  // Backend statuses: connected | paused | needs_auth | error
                  (conn.status === 'connected' || conn.status === 'active') && 'text-status-success',
                  conn.status === 'paused' && 'text-text-muted',
                  conn.status !== 'connected' && conn.status !== 'active' && conn.status !== 'paused' && 'text-status-error',
                )}
              >
                {conn.status === 'connected' || conn.status === 'active' ? (
                  <CheckCircle size={13} className="inline mr-1" />
                ) : (
                  <AlertCircle size={13} className="inline mr-1" />
                )}
                {mailboxStatusLabel(conn.status, t)}
              </span>
            </div>

            <div className="text-xs text-text-secondary">
              {t('syncStatus.lastSync', { when: formatDate(conn.lastSyncAt, t('syncStatus.never')) })}
            </div>

            {conn.lastError ? (
              <div className="text-xs text-status-error bg-status-error/5 rounded px-2 py-1 break-words">
                {conn.lastError}
              </div>
            ) : null}

            {conn.folders.filter((f) => f.isSelected).length > 0 ? (
              <div className="space-y-1 pt-1 border-t border-border/40">
                {conn.folders
                  .filter((f) => f.isSelected)
                  .map((f) => (
                    <div key={f.id} className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1 min-w-0">
                        <Folder size={11} className="text-text-muted shrink-0" />
                        <span className="text-xs text-text-secondary truncate">{f.folderName}</span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 text-xs text-text-muted">
                        <span>{t('syncStatus.messages', { count: f.messagesSynced })}</span>
                        {f.lastError ? (
                          <span title={f.lastError}>
                            <AlertCircle size={11} className="text-status-error" />
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ))}
              </div>
            ) : null}
          </div>
        ))
      )}
    </div>
  )
}
