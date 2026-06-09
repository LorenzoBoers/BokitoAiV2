import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, AlertCircle, CheckCircle, Folder } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { getSyncStatus, type SyncConnectionStatus } from '../../lib/inbox-api'
import { cn } from '../../lib/utils'

function formatDate(iso: string | null): string {
  if (!iso) return 'Nooit'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '–'
  return d.toLocaleString('nl-NL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

type Props = {
  className?: string
}

export default function SyncStatusPanel({ className }: Props) {
  const { token } = useAuth()
  const [statuses, setStatuses] = useState<SyncConnectionStatus[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    setError(null)
    try {
      const result = await getSyncStatus(token)
      setStatuses(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kon sync-status niet laden.')
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-heading">Sync status</h3>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="text-text-muted hover:text-text-primary transition-colors disabled:opacity-40"
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error ? (
        <p className="text-xs text-status-error">{error}</p>
      ) : statuses.length === 0 && !loading ? (
        <p className="text-xs text-text-muted">No mailboxes found.</p>
      ) : (
        statuses.map((conn) => (
          <div key={conn.id} className="rounded-lg border border-border/50 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-text-heading truncate">{conn.mailboxEmail || conn.displayName}</span>
              <span
                className={cn(
                  'text-xs font-medium shrink-0',
                  conn.status === 'active' ? 'text-status-success' : 'text-status-error',
                )}
              >
                {conn.status === 'active' ? (
                  <CheckCircle size={13} className="inline mr-1" />
                ) : (
                  <AlertCircle size={13} className="inline mr-1" />
                )}
                {conn.status}
              </span>
            </div>

            <div className="text-xs text-text-secondary">
              Laatste sync: {formatDate(conn.lastSyncAt)}
            </div>

            {conn.lastError ? (
              <div className="text-xs text-status-error bg-status-error/5 rounded px-2 py-1 break-words">
                {conn.lastError}
              </div>
            ) : null}

            {conn.folders.filter((f) => f.isSelected).length > 0 ? (
              <div className="space-y-1 pt-1 border-t border-border/30">
                {conn.folders
                  .filter((f) => f.isSelected)
                  .map((f) => (
                    <div key={f.id} className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1 min-w-0">
                        <Folder size={11} className="text-text-muted shrink-0" />
                        <span className="text-xs text-text-secondary truncate">{f.folderName}</span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 text-xs text-text-muted">
                        <span>{f.messagesSynced} berichten</span>
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
