import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Plus } from 'lucide-react'
import { Button } from '../ui/button'
import { ConnectionRow } from './ConnectionRow'
import { ConnectionScopeEditor } from './ConnectionScopeEditor'
import { listProviderConnections, type ProviderConnectionRow } from '../../lib/integrations-api'
import { useConnectionActions } from '../../lib/use-connection-actions'

/**
 * Every registration to one provider, managed in place: status, verify,
 * rename, disconnect, projects and access. Empty means the provider keeps its
 * logins elsewhere (mailboxes, repositories); ``onLoaded`` lets the caller fall back.
 */
export function ProviderConnectionsList({
  provider,
  onAddAnother,
  onChanged,
  onLoaded,
}: {
  provider: string
  onAddAnother?: () => void
  onChanged?: () => void
  onLoaded?: (count: number) => void
}) {
  const { t } = useTranslation('nav')
  const [rows, setRows] = useState<ProviderConnectionRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setLoadError(null)
      const data = await listProviderConnections(provider)
      const next = data.connections ?? []
      setRows(next)
      onLoaded?.(next.length)
    } catch (err) {
      setRows([])
      setLoadError(err instanceof Error ? err.message : String(err))
    }
  }, [provider, onLoaded])

  const reloadAndNotify = useCallback(async () => {
    await refresh()
    onChanged?.()
  }, [refresh, onChanged])

  const actions = useConnectionActions({ provider }, reloadAndNotify)

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (rows == null) {
    return (
      <div className="flex justify-center py-4">
        <Loader2 size={16} className="animate-spin text-text-muted" aria-hidden />
      </div>
    )
  }

  const error = loadError || actions.error
  if (rows.length === 0 && !error) return null

  return (
    <section className="space-y-3" data-testid="provider-connections">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-2xs font-semibold text-text-muted">
          {t('integrations.connections.listTitle', { count: rows.length })}
        </p>
        {onAddAnother ? (
          <Button type="button" size="sm" variant="secondary" className="gap-1.5" onClick={onAddAnother}>
            <Plus size={14} aria-hidden />
            {t('integrations.connections.addAnother')}
          </Button>
        ) : null}
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {actions.notice ? <p className="text-xs text-text-secondary">{actions.notice}</p> : null}
      {rows.length > 0 ? (
        <ul className="space-y-2">
          {rows.map((row) => (
            <ConnectionRow
              key={row.id}
              row={row}
              busy={actions.busyId === row.id}
              onVerify={() => void actions.verify(row)}
              onRename={(name) => void actions.rename(row, name)}
              onDisconnect={() => void actions.disconnect(row)}
              manage={
                <ConnectionScopeEditor
                  connectionId={row.connection_id || row.id}
                  projects={row.projects ?? []}
                  onSaved={reloadAndNotify}
                />
              }
            />
          ))}
        </ul>
      ) : null}
      {rows.length > 1 ? (
        <p className="text-xs text-text-muted">{t('integrations.connections.oneAdministrationNote')}</p>
      ) : null}
    </section>
  )
}
