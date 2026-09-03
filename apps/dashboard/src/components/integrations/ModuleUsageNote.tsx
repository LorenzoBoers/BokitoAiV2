import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { moduleHomePath, moduleNavIcon } from '../../lib/integration-modules'
import type { IntegrationModuleRow } from '../../lib/integrations-api'

/**
 * Which modules can run on this connection, and what agents do with it.
 * Keeps the marketplace flat: a login is one thing, a module is another.
 */
export function ModuleUsageNote({ modules }: { modules: IntegrationModuleRow[] }) {
  const { t } = useTranslation('nav')
  if (modules.length === 0) return null

  return (
    <div className="rounded-lg border border-border/60 bg-bg-elevated/40 px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
        {t('integrations.application.usedByModules', { defaultValue: 'Works with modules' })}
      </p>
      <ul className="mt-2 space-y-2">
        {modules.map((module) => {
          const Icon = moduleNavIcon(module.slug)
          const name = t(`integrations.modules.${module.slug}.name`, { defaultValue: module.name })
          const summary =
            t(`integrations.modules.${module.slug}.capabilitySummary`, {
              defaultValue: module.capability_summary ?? '',
            }) || module.description
          return (
            <li key={module.slug} className="flex items-start gap-2">
              <Icon size={14} className="mt-0.5 shrink-0 text-text-muted" aria-hidden />
              <div className="min-w-0">
                <Link
                  to={moduleHomePath(module)}
                  className="text-xs font-medium text-accent hover:underline"
                >
                  {name}
                </Link>
                <p className="text-[11px] leading-snug text-text-muted line-clamp-2">{summary}</p>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
