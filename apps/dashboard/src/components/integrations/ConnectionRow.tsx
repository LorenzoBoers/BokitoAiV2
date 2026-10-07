import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, Lock } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { IntegrationHostLogo } from './IntegrationHostLogo'
import type { ProviderConnectionRow } from '../../lib/integrations-api'
import { hostSlugForProvider, resolveProviderBrand } from '../../lib/integration-brand'
import { cn } from '../../lib/utils'

export type ConnectionRowCompany = { id: string; name: string }

type Props = {
  row: ProviderConnectionRow
  busy?: boolean
  onVerify: () => void
  onRename: (name: string) => void
  onDisconnect: () => void
  /** Module context: default badge, company chips, set default, remove from module. */
  isDefault?: boolean
  companies?: ConnectionRowCompany[]
  defaultCompanyId?: string | null
  onSetDefault?: (companyId?: string) => void
  onDetach?: () => void
  onFinishSetup?: () => void
  /** Expanded management (projects, access); shown behind a Manage toggle. */
  manage?: ReactNode
}

function statusKey(status: string): string {
  if (status === 'ready') return 'statusReady'
  if (status === 'error') return 'statusError'
  if (status === 'unverified') return 'statusUnverified'
  return 'needsCreds'
}

/** One registration: status, identity, scope chips and actions. Shared by the provider modal and module page. */
export function ConnectionRow({
  row,
  busy = false,
  onVerify,
  onRename,
  onDisconnect,
  isDefault = false,
  companies = [],
  defaultCompanyId,
  onSetDefault,
  onDetach,
  onFinishSetup,
  manage,
}: Props) {
  const { t } = useTranslation(['nav', 'common'])
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(row.display_name)
  const [expanded, setExpanded] = useState(false)
  const status = row.status || (row.ready ? 'ready' : 'needs_credentials')
  const brand = resolveProviderBrand(row.provider)
  const canManage = row.can_manage !== false
  const projects = row.projects ?? []

  return (
    <li className="panel px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-3">
          <IntegrationHostLogo
            logoUrl={brand.logoUrl}
            logoDarkUrl={brand.logoDarkUrl}
            initials={brand.initials}
            color={brand.color}
            name={row.vendor || brand.name}
            hostSlug={hostSlugForProvider(row.provider)}
            size="sm"
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-text-heading">{row.display_name}</p>
              {isDefault ? (
                <span className="rounded-md border border-accent/40 px-2 py-0.5 text-xs text-accent">
                  {t('integrations.connections.default')}
                </span>
              ) : null}
              <span
                className={cn(
                  'text-xs',
                  status === 'ready'
                    ? 'text-accent'
                    : status === 'error'
                      ? 'text-destructive'
                      : 'text-text-muted',
                )}
              >
                {t(`integrations.connections.${statusKey(status)}`)}
              </span>
              {row.access_restricted ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-border/60 px-1.5 py-0.5 text-2xs text-text-muted">
                  <Lock size={10} aria-hidden />
                  {t('integrations.connections.restricted')}
                </span>
              ) : null}
            </div>
            {row.identity ? (
              <p className="mt-0.5 text-xs text-text-secondary">{row.identity}</p>
            ) : null}
            {row.instance_key ? (
              <p className="mt-0.5 text-2xs text-text-muted">
                {t('integrations.connections.instanceKey', { key: row.instance_key })}
              </p>
            ) : null}
            {row.verify_error ? (
              <p className="mt-1 text-xs text-destructive">{row.verify_error}</p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {projects.length > 0
                ? projects.map((p) => (
                    <span
                      key={p.id}
                      className="rounded-md border border-border/60 bg-bg-muted/40 px-2 py-0.5 text-2xs text-text-secondary"
                    >
                      {p.name || p.id}
                    </span>
                  ))
                : (
                    <span className="text-2xs text-text-muted">
                      {t('integrations.connections.allProjects')}
                    </span>
                  )}
              {(row.attached_modules ?? []).map((slug) => (
                <span
                  key={slug}
                  className="rounded-md border border-border/40 px-2 py-0.5 text-2xs text-text-muted"
                >
                  {t(`integrations.modules.${slug}.name`, { defaultValue: slug })}
                </span>
              ))}
            </div>
            {companies.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {companies.map((company) => {
                  const isCompanyDefault = defaultCompanyId != null && company.id === defaultCompanyId
                  return (
                    <li key={company.id || company.name}>
                      <button
                        type="button"
                        disabled={busy || !company.id || !row.ready || !onSetDefault}
                        onClick={() => onSetDefault?.(company.id)}
                        className={cn(
                          'rounded-md border px-2 py-0.5 text-xs',
                          isCompanyDefault
                            ? 'border-border-light bg-bg-hover text-text-heading'
                            : 'border-border/60 text-text-secondary hover:border-border-light',
                        )}
                      >
                        {company.name || company.id}
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {!row.ready && onFinishSetup ? (
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onFinishSetup}>
              {t('integrations.connections.finishSetup')}
            </Button>
          ) : null}
          {canManage && row.can_verify !== false ? (
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onVerify}>
              {t('integrations.connections.verify')}
            </Button>
          ) : null}
          {onSetDefault && !isDefault && row.ready ? (
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => onSetDefault()}>
              {t('integrations.connections.setDefault')}
            </Button>
          ) : null}
          {canManage ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setRenameValue(row.display_name)
                setRenaming(true)
              }}
            >
              {t('integrations.connections.rename')}
            </Button>
          ) : null}
          {onDetach ? (
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onDetach}>
              {t('integrations.connections.detach')}
            </Button>
          ) : null}
          {canManage && row.can_disconnect !== false ? (
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onDisconnect}>
              {t('integrations.connections.disconnect')}
            </Button>
          ) : null}
          {manage && canManage ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="gap-1"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
            >
              {t('integrations.connections.manage')}
              {expanded ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
            </Button>
          ) : null}
        </div>
      </div>
      {manage && canManage && expanded ? (
        <div className="mt-3 border-t border-border/50 pt-3">{manage}</div>
      ) : null}

      <Dialog open={renaming} onOpenChange={setRenaming}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('integrations.connections.renameTitle')}</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-text-secondary">{t('integrations.connections.renameHint')}</p>
          {row.identity ? (
            <p className="text-xs text-text-muted">
              {t('integrations.connections.identity')}
              {': '}
              {row.identity}
            </p>
          ) : null}
          <div className="grid gap-2">
            <Label htmlFor={`conn-rename-${row.id}`}>{t('integrations.connections.renameLabel')}</Label>
            <Input
              id={`conn-rename-${row.id}`}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setRenaming(false)}>
              {t('common:cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              type="button"
              disabled={!renameValue.trim() || busy}
              onClick={() => {
                onRename(renameValue)
                setRenaming(false)
              }}
            >
              {t('common:save', { defaultValue: 'Save' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  )
}
