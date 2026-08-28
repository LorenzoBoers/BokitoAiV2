import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../ui/button'
import {
  listModuleConnections,
  renameModuleConnection,
  setModulePrefs,
  type ModuleConnectionRow,
} from '../../lib/module-api'

export function ModuleConnectionsPanel({
  slug,
  onAddPackage,
}: {
  slug: string
  onAddPackage: () => void
}) {
  const { t } = useTranslation(['nav', 'common'])
  const [rows, setRows] = useState<ModuleConnectionRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setError(null)
      const data = await listModuleConnections(slug)
      setRows(data.connections ?? [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [slug])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const setDefault = async (connectionId: string, companyId?: string) => {
    setBusyId(connectionId)
    try {
      await setModulePrefs(slug, {
        default_connection_id: connectionId,
        default_company_id: companyId ?? null,
      })
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  const rename = async (row: ModuleConnectionRow) => {
    const next = window.prompt(
      t('integrations.modules.connections.renamePrompt', {
        defaultValue: 'Registration name',
      }),
      row.display_name,
    )
    if (next == null || !next.trim() || next.trim() === row.display_name) return
    setBusyId(row.id)
    try {
      await renameModuleConnection(slug, row.id, next.trim())
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text-secondary">
          {t('integrations.modules.connections.intro', {
            defaultValue:
              'Each registration is a separate package login. Agents use the default unless a tool picks another.',
          })}
        </p>
        <Button type="button" size="sm" onClick={onAddPackage}>
          {t('integrations.modules.connections.add', {
            defaultValue: 'Add registration',
          })}
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {rows.length === 0 ? (
        <p className="text-sm text-text-muted">
          {t('integrations.modules.connections.empty', {
            defaultValue: 'No registrations yet. Connect a package from Overview.',
          })}
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li
              key={row.id}
              className="rounded-lg border border-border/60 bg-bg-surface px-4 py-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-text-heading">{row.display_name}</p>
                    {row.is_default ? (
                      <span className="rounded-full border border-accent/40 px-2 py-0.5 text-[11px] text-accent">
                        {t('integrations.modules.connections.default', {
                          defaultValue: 'Default',
                        })}
                      </span>
                    ) : null}
                    {!row.ready ? (
                      <span className="text-[11px] text-text-muted">
                        {t('integrations.modules.connections.needsCreds', {
                          defaultValue: 'Needs credentials',
                        })}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-xs text-text-muted">{row.vendor}</p>
                  {row.companies.length > 0 ? (
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {row.companies.map((company) => {
                        const cid = String(company.id || '')
                        const isCompanyDefault =
                          row.default_company_id && cid === row.default_company_id
                        return (
                          <li key={cid || String(company.name)}>
                            <button
                              type="button"
                              disabled={busyId === row.id || !cid}
                              onClick={() => void setDefault(row.id, cid)}
                              className={`rounded-md border px-2 py-0.5 text-[11px] ${
                                isCompanyDefault
                                  ? 'border-accent/50 bg-accent/10 text-accent'
                                  : 'border-border/60 text-text-secondary hover:border-accent/40'
                              }`}
                            >
                              {String(company.name || cid)}
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {!row.is_default ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busyId === row.id}
                      onClick={() => void setDefault(row.id)}
                    >
                      {t('integrations.modules.connections.setDefault', {
                        defaultValue: 'Set default',
                      })}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busyId === row.id}
                    onClick={() => void rename(row)}
                  >
                    {t('integrations.modules.connections.rename', {
                      defaultValue: 'Rename',
                    })}
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
