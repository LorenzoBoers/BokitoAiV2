import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { BrandMark } from './BrandMark'
import { IntegrationHostLogo } from './IntegrationHostLogo'
import {
  disconnectModuleConnection,
  listModuleConnections,
  renameModuleConnection,
  setModulePrefs,
  verifyModuleConnection,
  type ModuleConnectionRow,
} from '../../lib/module-api'
import { hostSlugForProvider, resolveProviderBrand } from '../../lib/integration-brand'
import { cn } from '../../lib/utils'

/** Overlapping marks for packages this module can use (channels-style). */
function PackageKindsMark({ hostSlugs }: { hostSlugs: string[] }) {
  if (hostSlugs.length === 0) return null
  return (
    <span className="inline-flex items-center" aria-hidden>
      {hostSlugs.map((slug, index) => (
        <span
          key={slug}
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-full border-2 border-bg-surface bg-bg-elevated shadow-sm',
            index > 0 && '-ml-1.5',
          )}
          style={{ zIndex: hostSlugs.length - index }}
        >
          <BrandMark slug={slug} size={13} />
        </span>
      ))}
    </span>
  )
}

function statusLabel(
  row: ModuleConnectionRow,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const status = row.status || (row.ready ? 'ready' : 'needs_credentials')
  if (status === 'ready') {
    return t('integrations.modules.connections.statusReady', { defaultValue: 'Verified' })
  }
  if (status === 'error') {
    return t('integrations.modules.connections.statusError', { defaultValue: 'Error' })
  }
  if (status === 'unverified') {
    return t('integrations.modules.connections.statusUnverified', {
      defaultValue: 'Unverified',
    })
  }
  return t('integrations.modules.connections.needsCreds', {
    defaultValue: 'Needs credentials',
  })
}

export function ModuleConnectionsPanel({
  slug,
  onAddPackage,
  packageHostSlugs = [],
  showTitle = true,
  refreshToken = 0,
  onFinishSetup,
}: {
  slug: string
  onAddPackage: () => void
  /** Host slugs for the stacked marks next to the title. */
  packageHostSlugs?: string[]
  showTitle?: boolean
  /** Increment to force a reload after hub save / OAuth return. */
  refreshToken?: number
  /** Open setup for a registration that still needs credentials. */
  onFinishSetup?: (row: ModuleConnectionRow) => void
}) {
  const { t } = useTranslation(['nav', 'common'])
  const [rows, setRows] = useState<ModuleConnectionRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [renameRow, setRenameRow] = useState<ModuleConnectionRow | null>(null)
  const [renameValue, setRenameValue] = useState('')

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
  }, [refresh, refreshToken])

  const setDefault = async (connectionId: string, companyId?: string) => {
    const target = rows.find((r) => r.id === connectionId)
    if (target && !target.ready) {
      setError(
        t('integrations.modules.connections.defaultRequiresReady', {
          defaultValue: 'Only a verified registration can be the default.',
        }),
      )
      return
    }
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

  const openRename = (row: ModuleConnectionRow) => {
    setRenameRow(row)
    setRenameValue(row.display_name)
  }

  const submitRename = async () => {
    if (!renameRow) return
    const next = renameValue.trim()
    if (!next || next === renameRow.display_name) {
      setRenameRow(null)
      return
    }
    setBusyId(renameRow.id)
    try {
      await renameModuleConnection(slug, renameRow.id, next)
      setRenameRow(null)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  const verify = async (row: ModuleConnectionRow) => {
    setBusyId(row.id)
    try {
      const result = await verifyModuleConnection(slug, row.id)
      if (!result.ok) {
        setError(
          result.error ||
            t('integrations.modules.connections.verifyFailed', {
              defaultValue: 'Verification failed.',
            }),
        )
      } else {
        setError(null)
      }
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  const disconnect = async (row: ModuleConnectionRow) => {
    const confirmed = window.confirm(
      t('integrations.modules.connections.disconnectConfirm', {
        defaultValue: 'Disconnect this registration? Agents will lose access to it.',
      }),
    )
    if (!confirmed) return
    setBusyId(row.id)
    try {
      await disconnectModuleConnection(slug, row.id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  const title: ReactNode = (
    <span className="inline-flex flex-wrap items-center gap-2.5">
      <span>
        {t('integrations.modules.tabs.connections', { defaultValue: 'Connections' })}
      </span>
      <PackageKindsMark hostSlugs={packageHostSlugs} />
    </span>
  )

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {showTitle ? (
            <h3 className="text-sm font-semibold text-text-heading">{title}</h3>
          ) : null}
          <p className={`text-sm text-text-secondary ${showTitle ? 'mt-1' : ''}`}>
            {t('integrations.modules.connections.intro', {
              defaultValue:
                'Each registration is a separate package login. Agents use the default unless a tool picks another.',
            })}
          </p>
        </div>
        <Button type="button" size="sm" onClick={onAddPackage} className="gap-1.5">
          <Plus size={14} aria-hidden />
          {t('integrations.modules.connections.add', {
            defaultValue: 'Add registration',
          })}
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/60 px-4 py-6 text-sm text-text-muted">
          {t('integrations.modules.connections.empty', {
            defaultValue: 'No registrations yet. Choose Add registration to pick a package.',
          })}
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => {
            const hostSlug = hostSlugForProvider(row.provider)
            const brand = resolveProviderBrand(row.provider)
            const status = row.status || (row.ready ? 'ready' : 'needs_credentials')
            return (
              <li
                key={row.id}
                className="rounded-lg border border-border/60 bg-bg-surface px-4 py-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-3">
                    <IntegrationHostLogo
                      logoUrl={brand.logoUrl}
                      logoDarkUrl={brand.logoDarkUrl}
                      initials={brand.initials}
                      color={brand.color}
                      name={row.vendor || brand.name}
                      hostSlug={hostSlug}
                      size="sm"
                    />
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
                        <span
                          className={cn(
                            'text-[11px]',
                            status === 'ready'
                              ? 'text-accent'
                              : status === 'error'
                                ? 'text-destructive'
                                : 'text-text-muted',
                          )}
                        >
                          {statusLabel(row, t)}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-text-muted">{row.vendor}</p>
                      {row.identity ? (
                        <p className="mt-0.5 text-xs text-text-secondary">{row.identity}</p>
                      ) : null}
                      {row.verify_error ? (
                        <p className="mt-1 text-xs text-destructive">{row.verify_error}</p>
                      ) : null}
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
                                  disabled={busyId === row.id || !cid || !row.ready}
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
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {!row.ready && onFinishSetup ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={busyId === row.id}
                        onClick={() => onFinishSetup(row)}
                      >
                        {t('integrations.modules.connections.finishSetup', {
                          defaultValue: 'Finish setup',
                        })}
                      </Button>
                    ) : null}
                    {row.can_verify !== false ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={busyId === row.id}
                        onClick={() => void verify(row)}
                      >
                        {t('integrations.modules.connections.verify', {
                          defaultValue: 'Verify',
                        })}
                      </Button>
                    ) : null}
                    {!row.is_default && row.ready ? (
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
                      onClick={() => openRename(row)}
                    >
                      {t('integrations.modules.connections.rename', {
                        defaultValue: 'Rename',
                      })}
                    </Button>
                    {row.can_disconnect !== false ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={busyId === row.id}
                        onClick={() => void disconnect(row)}
                      >
                        {t('integrations.modules.connections.disconnect', {
                          defaultValue: 'Disconnect',
                        })}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <Dialog open={renameRow != null} onOpenChange={(open) => !open && setRenameRow(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t('integrations.modules.connections.renameTitle', {
                defaultValue: 'Rename registration',
              })}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-text-secondary">
            {t('integrations.modules.connections.renameHint', {
              defaultValue:
                'This is a display label only. Provider identity stays separate after verification.',
            })}
          </p>
          {renameRow?.identity ? (
            <p className="text-xs text-text-muted">
              {t('integrations.modules.connections.identity', {
                defaultValue: 'Identity',
              })}
              {': '}
              {renameRow.identity}
            </p>
          ) : null}
          <div className="grid gap-2">
            <Label htmlFor="module-conn-rename">
              {t('integrations.modules.connections.renameLabel', {
                defaultValue: 'Label',
              })}
            </Label>
            <Input
              id="module-conn-rename"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setRenameRow(null)}>
              {t('common:cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              type="button"
              disabled={!renameValue.trim() || busyId === renameRow?.id}
              onClick={() => void submitRename()}
            >
              {t('common:save', { defaultValue: 'Save' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
