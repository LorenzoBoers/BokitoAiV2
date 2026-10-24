import { Check, AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Card } from '../ui/card'
import { Pressable } from '../ui/pressable'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table'
import { IntegrationHostLogo } from './IntegrationHostLogo'
import type { InstalledConnectionRow } from '../../lib/installed-connections'
import { cn } from '../../lib/utils'

function StatusMark({ status }: { status: InstalledConnectionRow['status'] }) {
  const { t } = useTranslation('nav')
  if (status === 'ready' || status === 'active') {
    return (
      <span className="inline-flex items-center gap-1 text-status-success" title={t('integrations.installed.statusReady')}>
        <Check size={16} aria-hidden />
        <span className="sr-only">{t('integrations.installed.statusReady')}</span>
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span className="inline-flex items-center gap-1 text-status-error" title={t('integrations.installed.statusError')}>
        <AlertTriangle size={16} aria-hidden />
        <span className="sr-only">{t('integrations.installed.statusError')}</span>
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-status-warning" title={t('integrations.installed.statusAttention')}>
      <AlertTriangle size={16} aria-hidden />
      <span className="sr-only">{t('integrations.installed.statusAttention')}</span>
    </span>
  )
}

type SharedProps = {
  rows: InstalledConnectionRow[]
  onManage: (row: InstalledConnectionRow) => void
}

/** One card per registration — multiple King logins stay separate cards. */
export function InstalledConnectionCards({ rows, onManage }: SharedProps) {
  const { t } = useTranslation('nav')

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((row) => (
        <Card key={row.id} asChild padding="compact">
          <Pressable
            type="button"
            onClick={() => onManage(row)}
            className="hover-lift flex min-h-[5.5rem] items-start gap-3 text-left hover:border-border"
          >
            <IntegrationHostLogo
              logoUrl={row.brand.logoUrl}
              logoDarkUrl={row.brand.logoDarkUrl}
              initials={row.brand.initials}
              color={row.brand.color}
              name={row.programName}
              hostSlug={row.brand.hostSlug}
              size="md"
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-text-heading">{row.title}</span>
                  <span className="mt-0.5 block truncate text-2xs text-text-muted">
                    {row.programName}
                    {row.instanceKey
                      ? ` · ${t('integrations.connections.instanceKey', { key: row.instanceKey })}`
                      : null}
                  </span>
                </span>
                <StatusMark status={row.status} />
              </span>
              {row.subtitle ? (
                <span className="mt-1 block truncate text-xs text-text-secondary">{row.subtitle}</span>
              ) : null}
              <span className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge variant="neutral" size="sm">
                  {t(`integrations.kind.${row.kind}`)}
                </Badge>
                {row.attachedModules.map((slug) => (
                  <Badge key={slug} variant="accent" size="sm">
                    {t(`integrations.modules.${slug}.name`, { defaultValue: slug })}
                  </Badge>
                ))}
              </span>
            </span>
          </Pressable>
        </Card>
      ))}
    </div>
  )
}

/** Flat list: Connector · Type · Status — easy when many administrations share a host. */
export function InstalledConnectionList({ rows, onManage }: SharedProps) {
  const { t } = useTranslation('nav')

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('integrations.installed.colConnector')}</TableHead>
          <TableHead className="hidden sm:table-cell">{t('integrations.installed.colType')}</TableHead>
          <TableHead className="w-36 text-right">{t('integrations.installed.colStatus')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id} className="cursor-pointer" onClick={() => onManage(row)}>
            <TableCell>
              <div className="flex min-w-0 items-center gap-3">
                <IntegrationHostLogo
                  logoUrl={row.brand.logoUrl}
                  logoDarkUrl={row.brand.logoDarkUrl}
                  initials={row.brand.initials}
                  color={row.brand.color}
                  name={row.programName}
                  hostSlug={row.brand.hostSlug}
                  size="sm"
                />
                <div className="min-w-0">
                  <p className="truncate font-medium text-text-heading">{row.title}</p>
                  <p className="truncate text-xs text-text-muted">
                    {row.subtitle || row.programName}
                    {row.instanceKey
                      ? ` · ${t('integrations.connections.instanceKey', { key: row.instanceKey })}`
                      : null}
                  </p>
                </div>
              </div>
            </TableCell>
            <TableCell className="hidden sm:table-cell">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="neutral" size="sm">
                  {t(`integrations.kind.${row.kind}`)}
                </Badge>
                {row.attachedModules[0] ? (
                  <Badge variant="accent" size="sm">
                    {t(`integrations.modules.${row.attachedModules[0]}.name`, {
                      defaultValue: row.attachedModules[0],
                    })}
                  </Badge>
                ) : null}
              </div>
            </TableCell>
            <TableCell className="text-right">
              <div className="inline-flex items-center justify-end gap-2">
                <StatusMark status={row.status} />
                {(row.status === 'error' || row.status === 'needs_attention') && (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={(e) => {
                      e.stopPropagation()
                      onManage(row)
                    }}
                  >
                    {t('integrations.installed.reconnect')}
                  </Button>
                )}
                {row.status === 'ready' || row.status === 'active' ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className={cn('hidden md:inline-flex')}
                    onClick={(e) => {
                      e.stopPropagation()
                      onManage(row)
                    }}
                  >
                    {t('integrations.actions.manage')}
                  </Button>
                ) : null}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
