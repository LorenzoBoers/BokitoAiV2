import { useTranslation } from 'react-i18next'
import { CANVAS_ICON } from '../../lib/entity-icons'
import RouteTabs from './RouteTabs'

/** Inner tab strip for Overview (scan / usage / canvas). The live
 * agent activity lives on `/agents#activity`. */
export default function CockpitTabs() {
  const { t } = useTranslation('nav')
  return (
    <RouteTabs
      ariaLabel={t('cockpitTabs.aria', { defaultValue: 'Cockpit sections' })}
      tabs={[
        { to: '/cockpit', end: true, label: t('cockpitTabs.overview', { defaultValue: 'Overview' }) },
        { to: '/cockpit/usage', label: t('cockpitTabs.usage', { defaultValue: 'Usage' }) },
        {
          to: '/cockpit/canvas',
          label: t('cockpitTabs.canvas', { defaultValue: 'Canvas' }),
          icon: CANVAS_ICON,
        },
      ]}
    />
  )
}
