import { useTranslation } from 'react-i18next'
import RouteTabs from './RouteTabs'

/** Inner tab strip for Overview (scan / canvas / usage). The live
 * activity log lives at `/activity`. */
export default function CockpitTabs() {
  const { t } = useTranslation('nav')
  return (
    <RouteTabs
      ariaLabel={t('cockpitTabs.aria', { defaultValue: 'Cockpit sections' })}
      tabs={[
        { to: '/cockpit', end: true, label: t('cockpitTabs.overview', { defaultValue: 'Overview' }) },
        { to: '/cockpit/canvas', label: t('cockpitTabs.canvas', { defaultValue: 'Canvas' }) },
        { to: '/cockpit/usage', label: t('cockpitTabs.usage', { defaultValue: 'Usage' }) },
      ]}
    />
  )
}
