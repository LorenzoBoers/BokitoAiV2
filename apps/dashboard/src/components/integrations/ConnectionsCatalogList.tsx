import { useTranslation } from 'react-i18next'
import { Clock } from 'lucide-react'
import {
  localizeApplication,
  type IntegrationApplication,
} from '../../lib/integration-applications'
import type { IntegrationKind } from '../../lib/integration-kind'
import { IntegrationHostLogo } from './IntegrationHostLogo'
import { Button } from '../ui/button'

type Props = {
  applications: IntegrationApplication[]
  kindFilter: IntegrationKind | 'all'
  query: string
  onOpen: (app: IntegrationApplication) => void
}

export function ConnectionsCatalogList({ applications, kindFilter, query, onOpen }: Props) {
  const { t } = useTranslation('nav')
  const needle = query.trim().toLowerCase()

  const rows = applications
    .filter((app) => app.status !== 'coming_soon')
    .filter((app) => kindFilter === 'all' || app.kinds.includes(kindFilter))
    .filter((app) => {
      if (!needle) return true
      const localized = localizeApplication(app, t)
      return `${localized.name} ${localized.description}`.toLowerCase().includes(needle)
    })
    .sort((a, b) => {
      const aCode = a.kinds.includes('repository') ? 1 : 0
      const bCode = b.kinds.includes('repository') ? 1 : 0
      if (aCode !== bCode) return aCode - bCode
      if ((a.connectionCount > 0) !== (b.connectionCount > 0)) {
        return a.connectionCount > 0 ? 1 : -1
      }
      return localizeApplication(a, t).name.localeCompare(localizeApplication(b, t).name)
    })

  if (rows.length === 0) {
    return <p className="text-sm text-text-muted">{t('integrations.connected.catalogEmpty')}</p>
  }

  return (
    <ul className="divide-y divide-border/50 rounded-xl border border-border/60 bg-bg-surface">
      {rows.map((app) => {
        const localized = localizeApplication(app, t)
        const connected = app.connectionCount > 0
        return (
          <li key={app.hostSlug} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <IntegrationHostLogo
                logoUrl={localized.brand.logoUrl}
                logoDarkUrl={localized.brand.logoDarkUrl}
                initials={localized.brand.initials}
                color={localized.brand.color}
                name={localized.name}
                hostSlug={localized.brand.hostSlug}
                size="sm"
              />
              <div className="min-w-0">
                <p className="text-sm font-medium text-text-heading truncate">{localized.name}</p>
                <p className="text-[11px] text-text-muted truncate">
                  {app.kinds.map((kind) => t(`integrations.kind.${kind}`)).join(' · ')}
                  {connected
                    ? ` · ${t('integrations.application.alreadyCount', { count: app.connectionCount })}`
                    : ''}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant={connected ? 'outline' : 'default'}
              onClick={() => onOpen(app)}
            >
              {app.status === 'coming_soon' ? (
                <>
                  <Clock size={14} className="mr-1.5" aria-hidden />
                  {t('integrations.actions.comingSoon')}
                </>
              ) : connected ? (
                t('integrations.actions.connectAnother')
              ) : (
                t('integrations.actions.setupConnection')
              )}
            </Button>
          </li>
        )
      })}
    </ul>
  )
}
