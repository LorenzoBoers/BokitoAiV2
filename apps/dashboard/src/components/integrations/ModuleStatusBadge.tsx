import { useTranslation } from 'react-i18next'
import { Badge } from '../ui/badge'
import { moduleStatusLabelKey, type IntegrationModuleRow } from '../../lib/integration-modules'

const DEFAULTS: Record<ReturnType<typeof moduleStatusLabelKey>, string> = {
  comingSoon: 'Coming soon',
  connectedBadge: 'Connected',
  onBadge: 'On',
  offBadge: 'Off',
}

const VARIANT: Record<ReturnType<typeof moduleStatusLabelKey>, 'warning' | 'success' | 'accent' | 'neutral'> =
  {
    comingSoon: 'warning',
    connectedBadge: 'success',
    onBadge: 'accent',
    offBadge: 'neutral',
  }

export function ModuleStatusBadge({
  module,
}: {
  module: Pick<IntegrationModuleRow, 'status' | 'tenant_status' | 'connected' | 'enabled'>
}) {
  const { t } = useTranslation('nav')
  const key = moduleStatusLabelKey(module)
  return (
    <Badge variant={VARIANT[key]} className="px-2 py-0.5 text-[10px] uppercase tracking-wide">
      {t(`integrations.modules.${key}`, { defaultValue: DEFAULTS[key] })}
    </Badge>
  )
}
