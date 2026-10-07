import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { Button } from '../ui/button'
import { useConfirm } from '../ui/confirm-dialog'
import { BrandMark } from './BrandMark'
import { ConnectionRow } from './ConnectionRow'
import { ConnectionScopeEditor } from './ConnectionScopeEditor'
import {
  attachModuleConnection,
  detachModuleConnection,
  listEligibleConnections,
  listModuleConnections,
  setModulePrefs,
  type EligibleModuleConnection,
  type ModuleConnectionRow,
} from '../../lib/module-api'
import { useConnectionActions } from '../../lib/use-connection-actions'
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
            'flex h-6 w-6 items-center justify-center rounded-full border-2 border-bg-surface bg-bg-elevated ',
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
  const confirm = useConfirm()
  const [rows, setRows] = useState<ModuleConnectionRow[]>([])
  const [eligible, setEligible] = useState<EligibleModuleConnection[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setLoadError(null)
      const [data, eligibleData] = await Promise.all([
        listModuleConnections(slug),
        listEligibleConnections(slug).catch(() => ({ connections: [] })),
      ])
      setRows(data.connections ?? [])
      setEligible(eligibleData.connections ?? [])
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    }
  }, [slug])

  const actions = useConnectionActions({ module: slug }, refresh)

  useEffect(() => {
    void refresh()
  }, [refresh, refreshToken])

  const setDefault = (row: ModuleConnectionRow, companyId?: string) => {
    if (!row.ready) {
      actions.setError(t('integrations.modules.connections.defaultRequiresReady'))
      return
    }
    void actions.run(row, () =>
      setModulePrefs(slug, {
        default_connection_id: row.id,
        default_company_id: companyId ?? null,
      }),
    )
  }

  const detach = (row: ModuleConnectionRow) => {
    void (async () => {
      if (
        !(await confirm({
          description: t('integrations.modules.connections.detachConfirm'),
          confirmLabel: t('actions.remove', { ns: 'common' }), destructive: true,
        }))
      )
        return
      await actions.run(row, () => detachModuleConnection(slug, row.id))
    })()
  }

  const attachExisting = (row: EligibleModuleConnection) => {
    void actions.run(row, () => attachModuleConnection(slug, row.id))
  }

  const title: ReactNode = (
    <span className="inline-flex flex-wrap items-center gap-2.5">
      <span>{t('integrations.modules.tabs.connections', { defaultValue: 'Connections' })}</span>
      <PackageKindsMark hostSlugs={packageHostSlugs} />
    </span>
  )
  const error = loadError || actions.error

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {showTitle ? <h3 className="text-sm font-semibold text-text-heading">{title}</h3> : null}
          <p className={`text-sm text-text-secondary ${showTitle ? 'mt-1' : ''}`}>
            {t('integrations.modules.connections.intro')}
          </p>
        </div>
        <Button type="button" size="sm" onClick={onAddPackage} className="gap-1.5">
          <Plus size={14} aria-hidden />
          {t('integrations.modules.connections.add')}
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {actions.notice ? <p className="text-xs text-text-secondary">{actions.notice}</p> : null}
      {eligible.length > 0 ? (
        <div className="rounded-lg border border-border/50 bg-bg-muted/30 px-4 py-3">
          <p className="text-xs font-medium text-text-heading">
            {t('integrations.modules.connections.useExisting')}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            {t('integrations.modules.connections.useExistingHint')}
          </p>
          <ul className="mt-2 space-y-2">
            {eligible.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-3">
                <span className="truncate-fade text-sm text-text-secondary">{row.display_name}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={actions.busyId === row.id}
                  onClick={() => attachExisting(row)}
                >
                  {t('integrations.modules.connections.useThis')}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border/60 px-4 py-6 text-sm text-text-muted">
          {t('integrations.modules.connections.empty')}
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <ConnectionRow
              key={row.id}
              row={row}
              busy={actions.busyId === row.id}
              isDefault={row.is_default}
              companies={row.companies.map((c) => ({
                id: String(c.id || ''),
                name: String(c.name || c.id || ''),
              }))}
              defaultCompanyId={row.default_company_id}
              onSetDefault={(companyId) => setDefault(row, companyId)}
              onDetach={() => detach(row)}
              onFinishSetup={onFinishSetup ? () => onFinishSetup(row) : undefined}
              onVerify={() => void actions.verify(row)}
              onRename={(name) => void actions.rename(row, name)}
              onDisconnect={() => void actions.disconnect(row)}
              manage={
                row.connection_id ? (
                  <ConnectionScopeEditor
                    connectionId={row.connection_id}
                    projects={row.projects ?? []}
                    onSaved={refresh}
                  />
                ) : undefined
              }
            />
          ))}
        </ul>
      )}
    </section>
  )
}
