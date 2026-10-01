import { useTranslation } from 'react-i18next'
import RouteTabs from './RouteTabs'

/**
 * Inner tab strip for the Connections hub: workspace inventory and discover.
 */
export default function IntegrationsTabs() {
  const { t } = useTranslation('nav')
  return (
    <RouteTabs
      ariaLabel={t('integrations.tabsAria', { defaultValue: 'Connections sections' })}
      tabs={[
        { to: '/connections', end: true, label: t('tabs.modules.title', { defaultValue: 'Connections' }) },
        {
          to: '/connections/marketplace',
          label: t('integrations.pageMeta.marketplace.title', { defaultValue: 'Marketplace' }),
        },
      ]}
    />
  )
}
