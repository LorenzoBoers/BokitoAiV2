import { useTranslation } from 'react-i18next'
import { Globe } from 'lucide-react'
import { Badge } from '../ui/badge'
import { regionLabel } from '../../lib/model-label'

type Props = {
  region: string | null | undefined
  className?: string
}

/** Where a model processes data: EU (default) or US (BYOK or explicit opt-in). */
export function RegionBadge({ region, className }: Props) {
  const { t } = useTranslation('nav')
  const key = (region ?? '').trim().toLowerCase()
  const variant = key === 'eu' ? 'success' : key === 'us' ? 'warning' : 'neutral'
  return (
    <Badge
      variant={variant}
      className={['gap-1 px-2 py-0.5 text-xs', className].filter(Boolean).join(' ')}
      title={t('dataRegion.badgeTitle', { region: regionLabel(key, t) })}
    >
      <Globe size={11} aria-hidden />
      {regionLabel(key, t)}
    </Badge>
  )
}
