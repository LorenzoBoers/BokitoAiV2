import { useTranslation } from 'react-i18next'
import { Badge } from '../ui/badge'
import { moduleStatusLabelKey, type IntegrationModuleRow } from '../../lib/integration-modules'

const DEFAULTS: Record<ReturnType<typeof moduleStatusLabelKey>, string> = {
  comingSoon: 'Coming soon',
  connectedBadge: 'Connected',
  installedBadge: 'Installed · no packages',
  setupBadge: 'Needs setup',
  notInstalledBadge: 'Not installed',
  onBadge: 'Installed',
  offBadge: 'Not installed',
}

const VARIANT: Record<
  ReturnType<typeof moduleStatusLabelKey>,
  'warning' | 'success' | 'accent' | 'neutral'
> = {
  comingSoon: 'warning',
  // Only Connected is green — Installed without packages is not "ready for agents".
  connectedBadge: 'success',
  installedBadge: 'accent',
  setupBadge: 'accent',
  notInstalledBadge: 'neutral',
  onBadge: 'accent',
  offBadge: 'neutral',
}

export function ModuleStatusBadge({
  module,
}: {
  module: Pick<
    IntegrationModuleRow,
    'status' | 'tenant_status' | 'connected' | 'enabled' | 'install_state'
  >
}) {
  const { t } = useTranslation('nav')
  const key = moduleStatusLabelKey(module)
  return (
    <Badge variant={VARIANT[key]} className="px-2 py-0.5 text-2xs">
      {t(`integrations.modules.${key}`, { defaultValue: DEFAULTS[key] })}
    </Badge>
  )
}
