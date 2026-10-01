import { useTranslation } from 'react-i18next'
import RouteTabs from './RouteTabs'

/** Inner tab strip for the Reports surface (Overview / Usage) — the live
 * activity log moved to `/activity` (standalone timeline). */
export default function CockpitTabs() {
  const { t } = useTranslation('nav')
  return (
    <RouteTabs
      ariaLabel={t('cockpitTabs.aria', { defaultValue: 'Cockpit sections' })}
      tabs={[
        { to: '/cockpit', end: true, label: t('cockpitTabs.overview', { defaultValue: 'Overview' }) },
        { to: '/cockpit/usage', label: t('cockpitTabs.usage', { defaultValue: 'Usage' }) },
      ]}
    />
  )
}
