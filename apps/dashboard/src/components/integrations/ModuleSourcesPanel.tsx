import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/button'
import { useConfirm } from '../ui/confirm-dialog'
import {
  createModuleSource,
  deleteModuleSource,
  listModuleSources,
  reindexModuleSource,
  setModuleSourceDisabled,
  type ModuleSourceRow,
} from '../../lib/module-api'
import { useEntityRefresh } from '../../lib/live-store'

export function ModuleSourcesPanel({ slug }: { slug: string }) {
  const { t } = useTranslation(['nav', 'common'])
  const confirm = useConfirm()
  const [rows, setRows] = useState<ModuleSourceRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setError(null)
      const data = await listModuleSources(slug)
      setRows(data.sources ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [slug])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const ids = new Set(rows.map((row) => row.id))
  useEntityRefresh(['module_source'], () => void refresh(), {
    match: (change) => change.op === 'created' || (change.id !== null && ids.has(change.id)),
  })

  const addUrl = async () => {
    if (!url.trim()) return
    setBusy(true)
    try {
      await createModuleSource(slug, { url: url.trim(), title: title.trim() || undefined })
      setUrl('')
      setTitle('')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const originLabel = (origin: string) =>
    origin === 'platform'
      ? t('integrations.modules.sources.originPlatform')
      : t('integrations.modules.sources.originTenant')

  const statusLabel = (status: string) =>
    t(`integrations.modules.sources.status.${status}`, { defaultValue: status })

  return (
    <section className="space-y-4">
      <p className="text-sm text-text-secondary">{t('integrations.modules.sources.intro')}</p>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <div className="flex flex-wrap items-end gap-2 rounded-lg border border-border/60 p-3">
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs text-text-muted">
          {t('integrations.modules.sources.titleLabel')}
          <input
            className="rounded-md border border-border/60 bg-bg-surface px-2 py-1.5 text-sm text-text-primary"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('integrations.modules.sources.titlePlaceholder')}
          />
        </label>
        <label className="flex min-w-[16rem] flex-[2] flex-col gap-1 text-xs text-text-muted">
          {t('integrations.modules.sources.urlLabel')}
          <input
            className="rounded-md border border-border/60 bg-bg-surface px-2 py-1.5 text-sm text-text-primary"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://"
          />
        </label>
        <Button type="button" size="sm" disabled={busy || !url.trim()} onClick={() => void addUrl()}>
          {t('integrations.modules.sources.add')}
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-text-muted">{t('integrations.modules.sources.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-border/60 px-3 py-2"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-text-heading">{row.title}</p>
                <a
                  href={row.url}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all text-xs text-accent hover:underline"
                >
                  {row.url}
                </a>
                <p className="mt-1 text-xs text-text-muted">
                  {originLabel(row.origin)} · {statusLabel(row.status)}
                  {row.pages_fetched
                    ? ` · ${t('integrations.modules.sources.pages', { count: row.pages_fetched })}`
                    : ''}
                  {row.last_synced_at
                    ? ` · ${t('integrations.modules.sources.lastSync', {
                        time: new Date(row.last_synced_at).toLocaleString(),
                      })}`
                    : ''}
                  {row.sync_error ? ` · ${row.sync_error}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={busy || row.status === 'disabled'}
                  onClick={() => {
                    setBusy(true)
                    setRows((current) =>
                      current.map((item) =>
                        item.id === row.id ? { ...item, status: 'indexing', sync_error: '' } : item,
                      ),
                    )
                    void reindexModuleSource(slug, row.id)
                      .then(() => refresh())
                      .catch((err) =>
                        setError(err instanceof Error ? err.message : String(err)),
                      )
                      .finally(() => setBusy(false))
                  }}
                >
                  {t('integrations.modules.sources.reindex')}
                </Button>
                {row.origin === 'platform' ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setBusy(true)
                      void setModuleSourceDisabled(slug, row.id, row.status !== 'disabled')
                        .then(() => refresh())
                        .catch((err) =>
                          setError(err instanceof Error ? err.message : String(err)),
                        )
                        .finally(() => setBusy(false))
                    }}
                  >
                    {row.status === 'disabled'
                      ? t('integrations.modules.sources.enable')
                      : t('integrations.modules.sources.disable')}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      void (async () => {
                        if (
                          !(await confirm({
                            description: t('integrations.modules.sources.deleteConfirm'),
                            destructive: true,
                          }))
                        ) {
                          return
                        }
                        setBusy(true)
                        await deleteModuleSource(slug, row.id)
                          .then(() => refresh())
                          .catch((err) =>
                            setError(err instanceof Error ? err.message : String(err)),
                          )
                          .finally(() => setBusy(false))
                      })()
                    }}
                  >
                    {t('common:actions.delete')}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
